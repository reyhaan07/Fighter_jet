import * as THREE from 'three';
import { NOISE } from '../../world/glsl.js';
import { ATMO } from '../../world/Atmosphere.js';

/**
 * Metallic skin with procedural panel lines, per-panel tone variation, soot
 * streaks and wear, computed in object (aircraft) space with triplanar mapping.
 * No textures are downloaded.
 */
export function createSkinMaterial({
  color = 0x4c535c,
  metalness = 0.6,
  roughness = 0.42,
  panelScale = 1.35,
  lineStrength = 0.32,
  soot = 1,
} = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color,
    metalness,
    roughness,
    clearcoat: 0.25,
    clearcoatRoughness: 0.5,
    envMapIntensity: 1.25,
  });

  mat.onBeforeCompile = (shader) => {
    ATMO.patch(shader);
    shader.uniforms.uPanelScale = { value: panelScale };
    shader.uniforms.uLine = { value: lineStrength };
    shader.uniforms.uSoot = { value: soot };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vObjPos;\nvarying vec3 vObjNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvObjPos = position;\nvObjNormal = normal;');

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vObjPos;
        varying vec3 vObjNormal;
        uniform float uPanelScale;
        uniform float uLine;
        uniform float uSoot;
        ${NOISE}
        // Staggered panel grid: returns (line mask, panel id).
        vec2 panels(vec2 p) {
          p *= uPanelScale;
          p.y *= 0.55;
          float row = floor(p.y);
          // Irregular panel widths per row, like real skin panels.
          float stretch = 0.6 + hash11(row * 7.31) * 0.9;
          p.x = p.x * stretch + hash11(row * 3.17) * 0.9;
          vec2 cell = floor(p);
          vec2 f = fract(p);
          vec2 d = min(f, 1.0 - f);
          vec2 w = fwidth(p);
          float lw = 0.007 * uPanelScale;
          float lx = 1.0 - smoothstep(lw, lw + w.x, d.x);
          float ly = 1.0 - smoothstep(lw, lw + w.y, d.y);
          // Some seams are omitted so the pattern never reads as a grid.
          lx *= step(0.28, hash12(cell + 0.5));
          float line = max(lx, ly);
          // Fade seams out when they get smaller than a pixel (no grey moire at distance).
          line *= 1.0 - smoothstep(0.08, 0.35, max(w.x, w.y));
          return vec2(line, hash12(cell));
        }
        float gPanelLine;
        float gPanelId;
        float gWear;
        `,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 n = abs(normalize(vObjNormal));
          vec3 w = pow(n, vec3(4.0));
          w /= (w.x + w.y + w.z);
          vec2 px = panels(vObjPos.zy);
          vec2 py = panels(vObjPos.zx);
          vec2 pz = panels(vObjPos.xy);
          gPanelLine = px.x * w.x + py.x * w.y + pz.x * w.z;
          gPanelId = px.y * w.x + py.y * w.y + pz.y * w.z;
          float grime = fbm(vObjPos.xz * vec2(1.4, 0.35) + vObjPos.y);
          float streak = vnoise(vec2(vObjPos.x * 9.0, vObjPos.z * 0.45));
          float rear = smoothstep(3.5, 8.5, vObjPos.z);
          gWear = grime;
          vec3 tone = vec3(1.0 + (gPanelId - 0.5) * 0.08);
          diffuseColor.rgb *= tone;
          diffuseColor.rgb *= 1.0 - gPanelLine * uLine;
          diffuseColor.rgb *= 1.0 - uSoot * rear * (0.25 + 0.35 * streak);
          diffuseColor.rgb *= 0.9 + 0.2 * grime;
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (gWear - 0.5) * 0.22 + gPanelLine * 0.25 + (gPanelId - 0.5) * 0.08, 0.08, 1.0);`,
      );
  };
  mat.customProgramCacheKey = () => 'skin-v2';
  return mat;
}
