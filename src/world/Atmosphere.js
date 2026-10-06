import * as THREE from 'three';

// Shared atmospheric fog for every material in the world.
//
// Replaces three.js' exponential fog with:
//   - height falloff: thick haze in valleys and near the sea, clear air at altitude
//   - sun in-scattering: the haze glows warm towards the sun
// Built-in materials get the uniforms through a default onBeforeCompile;
// custom shaders call atmoFog() from ATMO_GLSL directly.

export const ATMO = {
  uniforms: {
    uAtmoSun: { value: new THREE.Vector3(0, 1, 0) },
    uAtmoSunColor: { value: new THREE.Color(1, 0.9, 0.8) },
    uAtmoH: { value: 2200 },
    uAtmoGlow: { value: 0.6 },
  },
  patch(shader) {
    Object.assign(shader.uniforms, ATMO.uniforms);
  },
  set(sunDir, sunColor, glow) {
    this.uniforms.uAtmoSun.value.copy(sunDir);
    this.uniforms.uAtmoSunColor.value.copy(sunColor);
    this.uniforms.uAtmoGlow.value = glow;
  },
};

export const ATMO_GLSL = /* glsl */ `
uniform vec3 uAtmoSun;
uniform vec3 uAtmoSunColor;
uniform float uAtmoH;
uniform float uAtmoGlow;
vec3 atmoFog(vec3 col, vec3 fogCol, float density, vec3 worldPos) {
  vec3 ray = worldPos - cameraPosition;
  float d = length(ray);
  float y0 = max(cameraPosition.y, 0.0);
  float y1 = max(worldPos.y, 0.0);
  float dy = y1 - y0;
  // Average of exp(-y/H) along the ray (analytic).
  float hf = abs(dy) < 1.0 ? exp(-y0 / uAtmoH) : uAtmoH * (exp(-y0 / uAtmoH) - exp(-y1 / uAtmoH)) / dy;
  float k = density * d * (0.35 + 0.95 * hf);
  float f = 1.0 - exp(-k * k);
  float mu = max(dot(ray / max(d, 1e-3), uAtmoSun), 0.0);
  vec3 fc = fogCol + uAtmoSunColor * (pow(mu, 8.0) * uAtmoGlow + pow(mu, 2.0) * uAtmoGlow * 0.15);
  return mix(col, fc, f);
}
`;

let installed = false;

/** Patch three's fog shader chunks once, before any material compiles. */
export function installAtmosphere() {
  if (installed) return;
  installed = true;
  const C = THREE.ShaderChunk;
  C.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogWorld;
#endif`;
  C.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);
#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying vec3 vFogWorld;
  #ifdef FOG_EXP2
    uniform float fogDensity;
    ${ATMO_GLSL}
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    gl_FragColor.rgb = atmoFog(gl_FragColor.rgb, fogColor, fogDensity, vFogWorld);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
  // Every built-in material receives the shared uniforms.
  THREE.Material.prototype.onBeforeCompile = function (shader) {
    ATMO.patch(shader);
  };
}
