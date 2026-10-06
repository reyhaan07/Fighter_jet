import * as THREE from 'three';
import { rng } from '../core/math.js';

// Towns and cities: thousands of instanced buildings in one draw call.
// Facades get procedural window grids in the shader; at dusk and night a
// random share of the windows light up (and bloom), so cities glow from
// altitude.

const STRIDE = 8; // x, y, z, rotY, w, h, d, seed

const vertexShader = /* glsl */ `
  attribute vec4 aPos;   // x, y, z, rotY
  attribute vec4 aSize;  // w, h, d, seed
  uniform float uFogDensity;
  varying vec3 vLocal;
  varying vec3 vSize;
  varying vec3 vN;
  varying float vSeed;
  varying float vFog;
  varying float vDist;
  void main() {
    vec3 p = position * aSize.xyz;     // unit box with its base at y = 0
    float c = cos(aPos.w), s = sin(aPos.w);
    vec3 w = vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z) + aPos.xyz;
    vec3 n = normal;
    vN = vec3(c * n.x + s * n.z, n.y, -s * n.x + c * n.z);
    vLocal = p;
    vSize = aSize.xyz;
    vSeed = aSize.w;
    vec4 mv = viewMatrix * vec4(w, 1.0);
    vDist = length(mv.xyz);
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist);
    gl_Position = projectionMatrix * mv;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uSunDir, uSunColor, uSky, uGround, uFogColor;
  uniform float uSunStrength, uNight;
  varying vec3 vLocal;
  varying vec3 vSize;
  varying vec3 vN;
  varying float vSeed;
  varying float vFog;
  varying float vDist;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec3 n = normalize(vN);
    vec3 base = mix(vec3(0.42, 0.41, 0.4), vec3(0.62, 0.58, 0.52), fract(vSeed * 7.31));
    base *= mix(vec3(1.0), vec3(0.75, 0.8, 0.9), step(0.6, fract(vSeed * 3.7)));
    vec3 emissive = vec3(0.0);
    if (abs(n.y) < 0.5) {
      // Facade: window grid on the wall's horizontal axis + height.
      float u = abs(n.x) > 0.5 ? vLocal.z : vLocal.x;
      vec2 cell = vec2(u / 3.4, vLocal.y / 3.2);
      vec2 f = fract(cell);
      float win = step(0.22, f.x) * step(f.x, 0.78) * step(0.3, f.y) * step(f.y, 0.8) * step(2.0, vLocal.y);
      float detail = 1.0 - smoothstep(2500.0, 7000.0, vDist);
      base = mix(base, vec3(0.12, 0.15, 0.2), win * 0.8 * detail);
      float lit = step(0.45, h21(floor(cell) + vSeed * 91.0));
      emissive = vec3(1.0, 0.78, 0.45) * win * lit * uNight * uNight * 1.8;
      // Far away: average glow so cities still sparkle.
      emissive = mix(emissive, vec3(1.0, 0.78, 0.45) * 0.1 * uNight * uNight * step(0.4, fract(vSeed * 17.3)), 1.0 - detail);
    } else {
      base *= 0.6; // roofs
    }
    float ndl = max(dot(n, uSunDir), 0.0);
    vec3 amb = mix(uGround, uSky, n.y * 0.5 + 0.5) * 0.5;
    vec3 col = base * (amb + uSunColor * uSunStrength * ndl * 1.5) + emissive;
    col = mix(col, uFogColor, vFog * (1.0 - min(1.0, length(emissive)) * 0.6));
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class Towns {
  constructor({ terrain, count, sky, hemi, fogDensity, fogColor, seed, night }) {
    this.group = new THREE.Group();
    this.sites = [];
    this.disposables = [];
    if (!count) return;
    const rand = rng(seed * 13 + 5);
    const data = [];
    for (let t = 0; t < count * 4 && this.sites.length < count; t++) {
      const site = terrain.findLand((rand() * 2 - 1) * terrain.half * 0.7, (rand() * 2 - 1) * terrain.half * 0.7, 4000, 6, 260, rand);
      if (!site || terrain.slopeAt(site.x, site.z) > 0.12) continue;
      if (this.sites.some((s) => Math.hypot(s.x - site.x, s.z - site.z) < 3500)) continue;
      const size = 350 + rand() * 650;
      this.sites.push({ x: site.x, z: site.z, r: size });
      const rot = rand() * Math.PI;
      const c = Math.cos(rot);
      const s = Math.sin(rot);
      const block = 46;
      for (let gx = -size; gx <= size; gx += block) {
        for (let gz = -size; gz <= size; gz += block) {
          const d = Math.hypot(gx, gz) / size;
          if (d > 1 || rand() > 0.85 - d * 0.35) continue;
          const lx = gx + (rand() - 0.5) * 10;
          const lz = gz + (rand() - 0.5) * 10;
          const x = site.x + lx * c - lz * s;
          const z = site.z + lx * s + lz * c;
          const h = terrain.heightAt(x, z);
          if (h < 2 || terrain.slopeAt(x, z) > 0.25) continue;
          const core = Math.max(0, 1 - d * 1.4);
          const height = 8 + rand() * 14 + core * core * (30 + rand() * 90);
          const w = 14 + rand() * 18;
          const dd = 14 + rand() * 18;
          data.push(x, h - 6, z, rot, w, height + 6, dd, rand());
        }
      }
    }
    if (!data.length) return;
    const box = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = box.index;
    geo.setAttribute('position', box.attributes.position);
    geo.setAttribute('normal', box.attributes.normal);
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(data), STRIDE);
    geo.setAttribute('aPos', new THREE.InterleavedBufferAttribute(buf, 4, 0));
    geo.setAttribute('aSize', new THREE.InterleavedBufferAttribute(buf, 4, 4));
    geo.instanceCount = data.length / STRIDE;
    this.count = geo.instanceCount;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uFogDensity: { value: fogDensity },
        uFogColor: { value: fogColor },
        uSunDir: sky.uniforms.uSunDir,
        uSunColor: sky.uniforms.uSunColor,
        uSunStrength: sky.uniforms.uSunStrength,
        uSky: { value: hemi.color },
        uGround: { value: hemi.groundColor },
        uNight: { value: night },
      },
      vertexShader,
      fragmentShader,
    });
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.frustumCulled = false;
    this.group.add(mesh);
    this.disposables.push(box, geo, this.material);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
  }
}
