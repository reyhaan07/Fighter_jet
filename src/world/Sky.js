import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Sky dome adapted from the portfolio's high-altitude sky: zenith/horizon
// gradient, forward scattering around the sun, a sun disc, high cirrus and
// stars. Palettes give day, dusk and night missions. The same material renders
// the environment map used for reflections.

export const SKY_PRESETS = {
  day: {
    zenith: [0.06, 0.16, 0.42],
    horizon: [0.42, 0.52, 0.66],
    sunColor: [1.0, 0.92, 0.8],
    sunDir: [0.35, 0.62, -0.7],
    sunStrength: 2.4,
    disc: 22,
    stars: 0,
    cirrus: 0.45,
    sunLight: 3.2,
    hemiSky: 0x9fb8d8,
    hemiGround: 0x4a4436,
    hemi: 1.1,
    exposure: 0.74,
  },
  dusk: {
    zenith: [0.03, 0.06, 0.16],
    horizon: [0.55, 0.32, 0.22],
    sunColor: [1.0, 0.55, 0.28],
    sunDir: [-0.55, 0.08, -0.83],
    sunStrength: 2.2,
    disc: 16,
    stars: 0.25,
    cirrus: 0.6,
    sunLight: 2.4,
    hemiSky: 0x9a8aa8,
    hemiGround: 0x3a3028,
    hemi: 1.2,
    exposure: 0.83,
  },
  night: {
    zenith: [0.002, 0.004, 0.012],
    horizon: [0.03, 0.045, 0.07],
    sunColor: [0.55, 0.65, 0.9],
    sunDir: [0.3, 0.45, -0.84],
    sunStrength: 0.6,
    disc: 4,
    stars: 1,
    cirrus: 0.3,
    sunLight: 0.55,
    hemiSky: 0x40547a,
    hemiGround: 0x101318,
    hemi: 0.55,
    exposure: 1.1,
  },
};

export function createSkyMaterial(lite = false) {
  return new THREE.ShaderMaterial({
    defines: lite ? { SKY_LITE: '' } : {},
    uniforms: {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunStrength: { value: 1 },
      uDisc: { value: 10 },
      uStars: { value: 0 },
      uCirrus: { value: 0.5 },
      uMoon: { value: 0 },
      uTime: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uZenith, uHorizon, uSunColor, uSunDir;
      uniform float uSunStrength, uStars, uTime, uDisc, uCirrus, uMoon;
      varying vec3 vDir;
      ${NOISE}
      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 col = mix(uHorizon, uZenith, pow(smoothstep(-0.02, 0.6, h), 0.6));
        col = mix(col, uHorizon, smoothstep(0.0, -0.1, h)); // below horizon = fog colour

        float mu = max(dot(d, uSunDir), 0.0);
        vec3 sun = uSunColor * uSunStrength;
        float band = exp(-abs(h - 0.02) * 7.0);
        col += sun * band * (0.03 + 0.18 * pow(mu, 6.0));
        col += sun * pow(mu, 80.0) * 0.25;
        if (uMoon > 0.5) {
          // Moon: a larger mottled disc with a soft halo.
          float disc = smoothstep(0.99955, 0.99975, mu);
          float mott = 0.75 + 0.25 * fbm(d.xz * 900.0);
          col += vec3(0.85, 0.9, 1.0) * disc * mott * 2.2 + vec3(0.25, 0.3, 0.45) * pow(mu, 300.0) * 0.8;
        } else {
          col += sun * smoothstep(0.9993, 0.9997, mu) * uDisc * smoothstep(-0.02, 0.01, h);
          // Mie halo around the sun and a warm horizon glow beneath it.
          col += sun * pow(mu, 12.0) * 0.12 + sun * pow(mu, 4.0) * exp(-max(h, 0.0) * 6.0) * 0.1;
        }

        float cir = 0.0;
        #ifndef SKY_LITE
        if (uCirrus > 0.001 && h > 0.0) {
          vec2 cp = d.xz / max(d.y + 0.12, 0.05) * 1.4;
          cir = smoothstep(0.5, 0.9, fbm(cp * vec2(0.6, 2.2) + uTime * 0.002));
        }
        #endif
        col = mix(col, uHorizon * 1.15 + sun * 0.12 * pow(mu, 3.0), cir * smoothstep(0.02, 0.3, h) * uCirrus);

        if (uStars > 0.001) {
        vec3 sd = d * 420.0;
        vec3 cell = floor(sd);
        float s = hash13(cell);
        float star = step(0.9975, s) * smoothstep(0.05, 0.4, h) * (1.0 - cir);
        float tw = 0.7 + 0.3 * sin(uTime * (1.5 + s * 5.0) + s * 40.0);
        col += vec3(0.85, 0.9, 1.0) * star * tw * smoothstep(0.35, 0.0, length(fract(sd) - 0.5)) * 1.6 * uStars;
        }

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false,
    // Drawn after the opaque world at the far plane, so only pixels that
    // nothing else covers pay for the sky shader.
    depthTest: true,
    depthFunc: THREE.LessEqualDepth,
  });
}

export class Sky {
  constructor(presetName = 'day', lite = false) {
    this.material = createSkyMaterial(lite);
    this.geometry = new THREE.SphereGeometry(1000, 32, 16);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 50; // after terrain and models, before transparent effects
    this.setPreset(presetName);
  }

  setPreset(name) {
    const p = SKY_PRESETS[name] || SKY_PRESETS.day;
    this.preset = p;
    const u = this.material.uniforms;
    u.uZenith.value.setRGB(...p.zenith);
    u.uHorizon.value.setRGB(...p.horizon);
    u.uSunColor.value.setRGB(...p.sunColor);
    u.uSunDir.value.set(...p.sunDir).normalize();
    u.uSunStrength.value = p.sunStrength * 0.4;
    u.uDisc.value = p.disc;
    u.uStars.value = p.stars;
    u.uCirrus.value = p.cirrus;
    u.uMoon.value = name === 'night' ? 1 : 0;
  }

  get uniforms() {
    return this.material.uniforms;
  }

  update(camera, time) {
    this.mesh.position.copy(camera.position);
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
