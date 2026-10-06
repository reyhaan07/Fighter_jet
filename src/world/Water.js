import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Ocean surface at y = 0: scrolling noise normals, Fresnel sky reflection,
// sun glint and distance fog. The plane follows the camera so it reaches the
// horizon at any position.

export class Water {
  constructor(sky, fogDensity) {
    this.geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: sky.uniforms.uSunDir,
        uSunColor: sky.uniforms.uSunColor,
        uSunStrength: sky.uniforms.uSunStrength,
        uHorizon: sky.uniforms.uHorizon,
        uZenith: sky.uniforms.uZenith,
        uDeep: { value: new THREE.Color(0.01, 0.035, 0.06) },
        uFogDensity: { value: fogDensity },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uSunStrength, uFogDensity;
        uniform vec3 uSunDir, uSunColor, uHorizon, uZenith, uDeep;
        varying vec3 vWorld;
        ${NOISE}
        void main() {
          vec2 p = vWorld.xz;
          float e = 0.6;
          vec2 q1 = p * 0.012 + vec2(uTime * 0.02, uTime * 0.013);
          vec2 q2 = p * 0.045 - vec2(uTime * 0.05, -uTime * 0.03);
          float h = vnoise(q1) * 0.7 + vnoise(q2) * 0.3;
          float hx = vnoise(q1 + vec2(e * 0.012, 0.0)) * 0.7 + vnoise(q2 + vec2(e * 0.045, 0.0)) * 0.3;
          float hz = vnoise(q1 + vec2(0.0, e * 0.012)) * 0.7 + vnoise(q2 + vec2(0.0, e * 0.045)) * 0.3;
          vec3 n = normalize(vec3((h - hx) * 2.5, 1.0, (h - hz) * 2.5));
          vec3 toCam = cameraPosition - vWorld;
          float dist = length(toCam);
          vec3 v = toCam / dist;
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 r = reflect(-v, n);
          vec3 skyCol = mix(uHorizon, uZenith, smoothstep(0.0, 0.6, r.y));
          vec3 col = mix(uDeep, skyCol, fres);
          float spec = pow(max(dot(r, uSunDir), 0.0), 600.0) * 40.0 + pow(max(dot(r, uSunDir), 0.0), 40.0) * 0.4;
          col += uSunColor * uSunStrength * spec;
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uHorizon, fog);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.scale.set(80000, 1, 80000);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
  }

  update(camera, time) {
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
    this.material.uniforms.uTime.value = time;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
