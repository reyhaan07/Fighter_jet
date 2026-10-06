import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from '../core/math.js';
import { ATMO, ATMO_GLSL } from './Atmosphere.js';

// Instanced forests. Tree positions are generated once per level into
// 1 km chunks; only chunks within the quality's radius of the camera are
// copied into the instance buffers (re-streamed every few hundred metres),
// so tens of thousands of trees cost two draw calls and no per-frame work.
// The vertex shader handles orientation, size, wind sway and a distance fade.

const CHUNK = 1000;
const STRIDE = 5; // x, y, z, scale, seed

function coloured(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

function coniferGeometry() {
  const parts = [coloured(new THREE.CylinderGeometry(0.35, 0.5, 4, 5).translate(0, 2, 0), [0.28, 0.2, 0.13])];
  const tiers = [
    [3.6, 6.5, 3.2],
    [2.9, 5.5, 6.4],
    [2.0, 4.6, 9.4],
    [1.1, 3.4, 12.0],
  ];
  for (const [r, h, y] of tiers) parts.push(coloured(new THREE.ConeGeometry(r, h, 7).translate(0, y + h / 2 - 1, 0), [0.16, 0.3, 0.17]));
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

// Far LODs: a handful of triangles each.
function coniferFar() {
  const g = mergeGeometries([coloured(new THREE.ConeGeometry(3.4, 14, 4, 1).translate(0, 8, 0), [0.16, 0.3, 0.17])]);
  g.computeVertexNormals();
  return g;
}

function broadleafFar() {
  const g = mergeGeometries([coloured(new THREE.OctahedronGeometry(4.6, 0).scale(1, 0.85, 1).translate(0, 8, 0), [0.22, 0.36, 0.16])]);
  g.computeVertexNormals();
  return g;
}

function broadleafGeometry() {
  const parts = [coloured(new THREE.CylinderGeometry(0.4, 0.6, 5, 5).translate(0, 2.5, 0), [0.3, 0.22, 0.14])];
  const crown = new THREE.IcosahedronGeometry(4.5, 1);
  const pos = crown.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.85 + 0.3 * Math.sin(x * 1.7 + z * 2.3 + y);
    pos.setXYZ(i, x * k, y * 0.85 * k, z * k);
  }
  parts.push(coloured(crown.translate(0, 8, 0), [0.22, 0.36, 0.16]));
  parts.push(coloured(new THREE.IcosahedronGeometry(3, 0).translate(1.8, 6.5, 1.2), [0.2, 0.33, 0.15]));
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

const vertexShader = /* glsl */ `
  attribute vec4 aTree;  // x, y, z, scale
  attribute float aSeed;
  attribute vec3 color;
  uniform float uTime, uRadius, uFogDensity, uMapHalf;
  uniform vec3 uSunDir;
  uniform sampler2D uLightMap;
  varying vec2 vLm;
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vWorld;
  varying float vH;
  void main() {
    float a = aSeed * 6.2831;
    float c = cos(a), s = sin(a);
    vec3 p = position;
    p.xz = mat2(c, -s, s, c) * p.xz;
    float dCam = length(aTree.xz - cameraPosition.xz);
    float fade = 1.0 - smoothstep(uRadius * 0.82, uRadius, dCam);
    float sc = aTree.w * fade;
    // Wind sway grows with height.
    float sway = sin(uTime * 1.3 + aSeed * 40.0 + aTree.x * 0.01) * 0.03 * p.y;
    p.x += sway;
    vec3 w = aTree.xyz + p * sc;
    vec3 n = normal;
    n.xz = mat2(c, -s, s, c) * n.xz;
    vN = n;
    vH = position.y / 16.0;
    vColor = color * (0.8 + 0.45 * fract(aSeed * 13.7));
    vWorld = w;
    vLm = texture2D(uLightMap, clamp((aTree.xz + uMapHalf) / (2.0 * uMapHalf), 0.0, 1.0)).rg;
    vec4 mv = viewMatrix * vec4(w, 1.0);
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir, uSunColor, uSky, uGround, uFogColor;
  uniform float uSunStrength, uFogDensity;
  varying vec3 vColor;
  varying vec3 vN;
  varying vec3 vWorld;
  varying float vH;
  varying vec2 vLm;
  ${ATMO_GLSL}
  void main() {
    vec3 n = normalize(vN);
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5) * 0.55 * (0.4 + 0.6 * vLm.g);
    vec3 col = vColor * (amb + uSunColor * uSunStrength * ndl * 1.6 * vLm.r) * (0.65 + 0.35 * vH);
    col = atmoFog(col, uFogColor, uFogDensity, vWorld);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Forest {
  constructor({ terrain, quality, sky, hemi, fogDensity, fogColor, seed }) {
    const cfg = quality.trees;
    this.enabled = !!cfg && terrain.palette.trees > 0;
    this.terrain = terrain;
    this.group = new THREE.Group();
    this.disposables = [];
    if (!this.enabled) return;
    this.radius = cfg.radius;
    this.chunks = new Map();
    this._generate(cfg.attempts, seed);

    const capacity = Math.min(this.total, 120000);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: this.radius },
        uFogDensity: { value: fogDensity },
        uFogColor: { value: fogColor },
        uSunDir: sky.uniforms.uSunDir,
        uSunColor: sky.uniforms.uSunColor,
        uSunStrength: sky.uniforms.uSunStrength,
        uSky: { value: hemi.color },
        uGround: { value: hemi.groundColor },
        ...ATMO.uniforms,
        uLightMap: { value: terrain.lightMap },
        uMapHalf: { value: terrain.half },
      },
      vertexShader,
      fragmentShader,
    });
    this.disposables.push(this.material);
    this.nearRadius = Math.min(1300, this.radius * 0.4);
    // kinds: [conifer near, broadleaf near, conifer far, broadleaf far]
    this.kinds = [coniferGeometry(), broadleafGeometry(), coniferFar(), broadleafFar()].map((base) => {
      const geo = new THREE.InstancedBufferGeometry();
      geo.setAttribute('position', base.attributes.position);
      geo.setAttribute('normal', base.attributes.normal);
      geo.setAttribute('color', base.attributes.color);
      const data = new Float32Array(capacity * STRIDE);
      const buf = new THREE.InstancedInterleavedBuffer(data, STRIDE);
      buf.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aTree', new THREE.InterleavedBufferAttribute(buf, 4, 0));
      geo.setAttribute('aSeed', new THREE.InterleavedBufferAttribute(buf, 1, 4));
      geo.instanceCount = 0;
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.disposables.push(geo, base);
      return { geo, buf, data, capacity, mesh };
    });
    this.center = new THREE.Vector2(1e9, 1e9);
    this.restreamDistance = 200;
  }

  _generate(attempts, seed) {
    const t = this.terrain;
    const rand = rng(seed * 31 + 7);
    const half = t.half * 0.92;
    const treeLine = t.palette.trees;
    let total = 0;
    for (let i = 0; i < attempts; i++) {
      const x = (rand() * 2 - 1) * half;
      const z = (rand() * 2 - 1) * half;
      // Forest density: large patches with clearings.
      const dens = t.forestAt(x, z);
      if (dens < 0.47) continue;
      const h = t.heightAt(x, z);
      if (h < 14 || h > treeLine + (dens - 0.5) * 400) continue;
      if (t.slopeAt(x, z) > 0.42) continue;
      // Each accepted seed point grows a small grove.
      const grove = 3 + Math.floor(rand() * 5);
      for (let g = 0; g < grove; g++) {
        const gx = x + (rand() - 0.5) * 60;
        const gz = z + (rand() - 0.5) * 60;
        const gh = t.heightAt(gx, gz);
        if (gh < 14 || gh > treeLine) continue;
        const kind = gh > treeLine * 0.55 ? 0 : rand() < 0.55 ? 1 : 0;
        const key = Math.floor(gx / CHUNK) * 4096 + Math.floor(gz / CHUNK);
        let c = this.chunks.get(key);
        if (!c) {
          c = { cx: (Math.floor(gx / CHUNK) + 0.5) * CHUNK, cz: (Math.floor(gz / CHUNK) + 0.5) * CHUNK, lists: [[], []] };
          this.chunks.set(key, c);
        }
        const sc = 0.75 + rand() * 0.75 + (dens - 0.47) * 1.2;
        c.lists[kind].push(gx, gh - 0.5, gz, sc, rand());
        total++;
      }
    }
    // Freeze into typed arrays for fast copying.
    for (const c of this.chunks.values()) c.arrays = c.lists.map((l) => new Float32Array(l));
    this.chunkList = [...this.chunks.values()];
    this.total = total;
  }

  /** Re-stream nearby chunks when the camera has moved far enough. */
  update(camera, time) {
    if (!this.enabled) return;
    this.material.uniforms.uTime.value = time;
    const cx = camera.position.x;
    const cz = camera.position.z;
    if (Math.hypot(cx - this.center.x, cz - this.center.y) < this.restreamDistance) return;
    this.center.set(cx, cz);
    const r = this.radius + CHUNK * 0.75;
    const nr = this.nearRadius + CHUNK * 0.5;
    const counts = this._counts || (this._counts = [0, 0, 0, 0]);
    counts.fill(0);
    for (const c of this.chunkList) {
      const dx = Math.abs(c.cx - cx);
      const dz = Math.abs(c.cz - cz);
      if (dx > r || dz > r) continue;
      const far = Math.hypot(dx, dz) > nr ? 2 : 0;
      for (let k = 0; k < 2; k++) {
        const kind = this.kinds[k + far];
        const arr = c.arrays[k];
        const count = arr.length / STRIDE;
        if (counts[k + far] + count > kind.capacity) continue;
        kind.data.set(arr, counts[k + far] * STRIDE);
        counts[k + far] += count;
      }
    }
    for (let k = 0; k < 4; k++) {
      const kind = this.kinds[k];
      const n = counts[k];
      kind.geo.instanceCount = n;
      if (!n) continue;
      kind.buf.clearUpdateRanges();
      kind.buf.addUpdateRange(0, n * STRIDE);
      kind.buf.needsUpdate = true;
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
