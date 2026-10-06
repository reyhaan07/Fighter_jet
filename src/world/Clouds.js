import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Instanced cloud billboards adapted from the portfolio's CloudPuffs. Instead
// of scrolling with "travel", each puff lives in a box that wraps around the
// camera, so a fixed number of billboards fills an endless sky in one draw call.

export class Clouds {
  constructor({ count, sky, fogDensity, base = 1900, thickness = 900, box = 14000, night = false }) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.setAttribute('uv', quad.getAttribute('uv'));
    const offsets = new Float32Array(count * 3);
    const scales = new Float32Array(count);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Clustered: clouds come in groups so there are clear skies in between.
      const cluster = Math.floor(Math.random() * Math.max(4, count / 6));
      const cx = (Math.sin(cluster * 12.9898) * 43758.5453) % 1;
      const cz = (Math.sin(cluster * 78.233) * 12543.1234) % 1;
      offsets[i * 3] = (Math.abs(cx) + (Math.random() - 0.5) * 0.08) * box;
      offsets[i * 3 + 1] = base + Math.random() * thickness;
      offsets[i * 3 + 2] = (Math.abs(cz) + (Math.random() - 0.5) * 0.08) * box;
      scales[i] = 320 + Math.random() * 520;
      seeds[i] = Math.random();
    }
    geo.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scales, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.instanceCount = count;
    this.quad = quad;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uBox: { value: box },
        uSunDir: sky.uniforms.uSunDir,
        uSunColor: sky.uniforms.uSunColor,
        uSunStrength: sky.uniforms.uSunStrength,
        uHorizon: sky.uniforms.uHorizon,
        uLit: { value: night ? new THREE.Color(0.05, 0.06, 0.08) : new THREE.Color(0.95, 0.95, 0.97) },
        uShade: { value: night ? new THREE.Color(0.015, 0.018, 0.025) : new THREE.Color(0.48, 0.52, 0.6) },
        uFogDensity: { value: fogDensity },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute float aScale;
        attribute float aSeed;
        uniform float uBox, uTime;
        uniform vec3 uSunDir;
        varying vec2 vUv;
        varying float vSeed, vFade, vSun, vDist;
        void main() {
          vec3 c = aOffset;
          c.x += uTime * 4.0;
          c.xz = cameraPosition.xz + mod(c.xz - cameraPosition.xz + uBox * 0.5, uBox) - uBox * 0.5;
          vec4 mv = viewMatrix * vec4(c, 1.0);
          float dist = length(mv.xyz);
          vDist = dist;
          vec2 rel = abs(c.xz - cameraPosition.xz) / (uBox * 0.5);
          float edge = 1.0 - smoothstep(0.75, 1.0, max(rel.x, rel.y));
          vFade = edge * smoothstep(aScale * 0.35, aScale * 1.1, dist); // fade when flying through
          vSun = max(dot(normalize(c - cameraPosition), uSunDir), 0.0);
          float rot = aSeed * 6.2831;
          vec2 p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * position.xy;
          mv.xy += p * aScale * vec2(1.7, 0.85);
          vUv = uv;
          vSeed = aSeed;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uSunStrength, uFogDensity;
        uniform vec3 uSunColor, uHorizon, uShade, uLit;
        varying vec2 vUv;
        varying float vSeed, vFade, vSun, vDist;
        ${NOISE}
        void main() {
          vec2 p = vUv - 0.5;
          float r = length(p * vec2(1.0, 1.3));
          float n = fbm(vUv * 3.0 + vSeed * 17.0);
          float shape = smoothstep(0.5, 0.1, r + (n - 0.5) * 0.5);
          if (shape * vFade < 0.004) discard;
          float lit = smoothstep(-0.35, 0.4, -p.y + (n - 0.5) * 0.45);
          vec3 col = mix(uShade, uLit, lit);
          col += uSunColor * uSunStrength * pow(vSun, 8.0) * (1.0 - shape) * 0.6;
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDist * vDist * 0.6);
          col = mix(col, uHorizon, fog);
          gl_FragColor = vec4(col, shape * vFade * 0.85);
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
    this.material.dispose();
  }
}
