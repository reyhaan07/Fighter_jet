import * as THREE from 'three';

// Cumulus clouds built from clusters of instanced billboards (grown from the
// portfolio's CloudPuffs). Each puff knows its offset inside its cloud, which
// gives it a fake volumetric normal: sunlit tops, darker flat bases, a silver
// lining when backlit. Clouds live in a box that wraps around the camera, so a
// fixed budget fills an endless sky in one draw call. A pre-baked noise
// texture keeps the per-pixel cost to a single texture read.

/** Soft cauliflower puff: smooth falloff with gentle billows (no holes). */
function cloudTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const blobs = [];
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 0.28;
    blobs.push([0.5 + Math.cos(a) * r, 0.52 + Math.sin(a) * r * 0.8, 0.14 + Math.random() * 0.14]);
  }
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      let d = 0;
      for (const [bx, by, br] of blobs) {
        const q = Math.hypot(u - bx, v - by) / br;
        d = Math.max(d, 1 - q * q);
      }
      const edge = 1 - Math.min(1, Math.hypot(u - 0.5, v - 0.5) * 2);
      const a = Math.max(0, Math.min(1, d * 1.3)) * Math.min(1, edge * 3);
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Clouds {
  constructor({ count, sky, fogDensity, base = 1900, thickness = 900, box = 16000, night = false }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const center = new Float32Array(count * 3);
    const local = new Float32Array(count * 4); // offset xyz, cloud radius
    const misc = new Float32Array(count * 2); // scale, seed
    let i = 0;
    while (i < count) {
      // One cumulus: a dome of puffs over a flat base.
      const cx = Math.random() * box;
      const cz = Math.random() * box;
      const cy = base + Math.random() * thickness * 0.5;
      const R = 260 + Math.random() * 520;
      const puffs = Math.min(count - i, 7 + Math.floor((R / 780) * 14));
      for (let k = 0; k < puffs; k++, i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * R;
        const dome = 1 - (r / R) * (r / R);
        center.set([cx, cy, cz], i * 3);
        local.set([Math.cos(a) * r * 1.25, Math.max(0, dome * R * 0.75 * Math.random() + R * 0.08), Math.sin(a) * r, R], i * 4);
        misc.set([R * (0.55 + Math.random() * 0.5) * (0.6 + dome * 0.6), Math.random()], i * 2);
      }
    }
    geo.setAttribute('aCenter', new THREE.InstancedBufferAttribute(center, 3));
    geo.setAttribute('aLocal', new THREE.InstancedBufferAttribute(local, 4));
    geo.setAttribute('aMisc', new THREE.InstancedBufferAttribute(misc, 2));
    geo.instanceCount = count;
    this.quad = quad;
    this.texture = cloudTexture();

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box },
        uTex: { value: this.texture },
        uSunDir: sky.uniforms.uSunDir,
        uSunColor: sky.uniforms.uSunColor,
        uSunStrength: sky.uniforms.uSunStrength,
        uHorizon: sky.uniforms.uHorizon,
        uZenith: sky.uniforms.uZenith,
        uLit: { value: night ? new THREE.Color(0.06, 0.07, 0.09) : new THREE.Color(1.0, 0.98, 0.96) },
        uShade: { value: night ? new THREE.Color(0.012, 0.015, 0.022) : new THREE.Color(0.42, 0.47, 0.56) },
        uFogDensity: { value: fogDensity },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aCenter;
        attribute vec4 aLocal;
        attribute vec2 aMisc;
        uniform float uBox, uTime;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying float vSeed, vFade, vLight, vBack, vDist, vBase;
        void main() {
          vec3 c = aCenter;
          c.x += uTime * 5.0;
          c.xz = cameraPosition.xz + mod(c.xz - cameraPosition.xz + uBox * 0.5, uBox) - uBox * 0.5;
          vec3 wp = c + aLocal.xyz;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          float dist = length(mv.xyz);
          vDist = dist;
          vec2 rel = abs(c.xz - cameraPosition.xz) / (uBox * 0.5);
          float edge = 1.0 - smoothstep(0.7, 1.0, max(rel.x, rel.y));
          vFade = edge * smoothstep(aMisc.x * 0.3, aMisc.x * 1.2, dist);
          // Fake volume: normal from the puff's position inside its cloud.
          vec3 n = normalize(aLocal.xyz / aLocal.w + vec3(0.0, 0.25, 0.0));
          vLight = clamp(dot(n, uSunDir) * 0.6 + 0.45, 0.0, 1.0) * (0.55 + 0.45 * clamp(aLocal.y / (aLocal.w * 0.6), 0.0, 1.0));
          vBase = 1.0 - clamp(aLocal.y / (aLocal.w * 0.35), 0.0, 1.0);
          vBack = pow(max(dot(normalize(wp - cameraPosition), uSunDir), 0.0), 6.0);
          float rot = aMisc.y * 6.2831 + uTime * 0.004 * (aMisc.y - 0.5);
          vec2 p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
          mv.xy += p * aMisc.x * 2.0;
          vUv = uv;
          vSeed = aMisc.y;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        uniform float uSunStrength, uFogDensity;
        uniform vec3 uSunColor, uHorizon, uZenith, uShade, uLit;
        varying vec2 vUv;
        varying float vSeed, vFade, vLight, vBack, vDist, vBase;
        void main() {
          vec2 uv = vUv;
          if (vSeed > 0.5) uv.x = 1.0 - uv.x;
          float a = texture2D(uTex, uv).a;
          a *= vFade;
          if (a < 0.01) discard;
          // Brighter towards the puff's sun side (screen-space hint).
          float shape = smoothstep(0.0, 0.9, a);
          vec3 col = mix(uShade, uLit, vLight);
          col = mix(col, uShade * 0.85, vBase * 0.35);
          col *= mix(vec3(1.0), uSunColor * 1.15, 0.35);
          col += uZenith * 0.25;
          col += uSunColor * uSunStrength * vBack * (1.0 - shape) * shape * 2.0; // silver lining
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist * 0.55);
          col = mix(col, uHorizon, fog);
          gl_FragColor = vec4(col, a * 0.92);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'clouds';
  }

  update(time) {
    this.material.uniforms.uTime.value = time;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.quad.dispose();
    this.texture.dispose();
    this.material.dispose();
  }
}
