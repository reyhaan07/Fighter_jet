import * as THREE from 'three';
import { fbm2, valueNoise, clamp, smoothstep, lerp } from '../core/math.js';
import { NOISE } from './glsl.js';
import { ATMO } from './Atmosphere.js';

// Procedural heightfield terrain. Heights are generated once into a grid and
// the same grid drives both the rendered mesh and gameplay queries
// (heightAt), so collisions always match what you see. Water is at y = 0.

export const TERRAIN_TYPES = {
  islands: { land: 0.42, mountains: 900, palette: 'temperate' },
  coast: { land: 0.55, mountains: 1200, palette: 'temperate' },
  mountains: { land: 0.95, mountains: 1900, palette: 'alpine' },
  desert: { land: 0.98, mountains: 700, palette: 'desert' },
  ocean: { land: 0.08, mountains: 400, palette: 'temperate' },
  arctic: { land: 0.6, mountains: 1400, palette: 'arctic' },
};

const PALETTES = {
  temperate: { sand: [0.62, 0.56, 0.42], low: [0.22, 0.32, 0.14], high: [0.16, 0.22, 0.11], rock: [0.36, 0.34, 0.31], snow: [0.9, 0.92, 0.95], snowLine: 1300, seabed: [0.12, 0.2, 0.22], fields: 1, trees: 1100 },
  alpine: { sand: [0.45, 0.42, 0.36], low: [0.2, 0.3, 0.13], high: [0.14, 0.2, 0.1], rock: [0.33, 0.32, 0.31], snow: [0.92, 0.94, 0.97], snowLine: 1150, seabed: [0.1, 0.16, 0.18], fields: 0.6, trees: 1050 },
  desert: { sand: [0.72, 0.58, 0.38], low: [0.68, 0.52, 0.33], high: [0.6, 0.43, 0.27], rock: [0.5, 0.36, 0.24], snow: [0.75, 0.62, 0.45], snowLine: 99999, seabed: [0.3, 0.28, 0.2], fields: 0.25, trees: 0 },
  arctic: { sand: [0.55, 0.56, 0.58], low: [0.78, 0.8, 0.84], high: [0.86, 0.88, 0.92], rock: [0.32, 0.33, 0.36], snow: [0.95, 0.96, 0.99], snowLine: 300, seabed: [0.08, 0.14, 0.18], fields: 0, trees: 420 },
};

export class Terrain {
  constructor({ size = 32000, res = 256, seed = 1, type = 'islands', flatZones = [], sunDir = null }) {
    this.size = size;
    this.res = res;
    this.seed = seed;
    this.def = TERRAIN_TYPES[type] || TERRAIN_TYPES.islands;
    this.palette = PALETTES[this.def.palette];
    this.flatZones = flatZones; // [{x, z, r, h}] areas flattened for bases/cities
    this.half = size / 2;
    this.cell = size / (res - 1);
    this.heights = new Float32Array(res * res);
    this._generate();
    this.lightMap = this._bakeLight(sunDir);
    this.mesh = this._buildMesh();
    this.depthTexture = this._buildDepthTexture();
  }

  /** Raw procedural height (only used while generating the grid). */
  _height(x, z) {
    const s = this.seed;
    const d = this.def;
    const sc = 1 / 9000;
    // Continent mask: large-scale shape decides land vs sea.
    let m = fbm2(x * sc + 13.1, z * sc - 7.7, 4, s) - (0.5 - d.land * 0.45);
    m = m * 2.6 + (d.land - 0.5) * 1.2;
    const land = smoothstep(-0.05, 0.35, m);
    // Ridged mountains.
    const rx = x / 3200;
    const rz = z / 3200;
    let ridge = 0;
    let amp = 0.55;
    let f = 1;
    for (let i = 0; i < 5; i++) {
      const n = 1 - Math.abs(valueNoise(rx * f, rz * f, s + 101 + i) * 2 - 1);
      ridge += n * n * amp;
      f *= 2.1;
      amp *= 0.48;
    }
    const hills = fbm2(x / 1400, z / 1400, 4, s + 51);
    const mountainMask = smoothstep(0.35, 0.75, fbm2(x / 7000 + 4.2, z / 7000 - 1.3, 3, s + 77));
    let h = land * (40 + hills * 220 + ridge * d.mountains * (0.25 + mountainMask)) - (1 - land) * 220;
    if (d.palette === 'desert') h = land * (30 + hills * 140 + Math.pow(ridge, 3) * d.mountains * 2.2 * mountainMask);
    h += (m - 0.1) * 60;
    for (const fz of this.flatZones) {
      const dx = x - fz.x;
      const dz = z - fz.z;
      const t = smoothstep(fz.r, fz.r * 0.6, Math.sqrt(dx * dx + dz * dz));
      h = lerp(h, fz.h, t);
    }
    // Keep the outer border low so the map edge sinks into the sea.
    const edge = Math.max(Math.abs(x), Math.abs(z)) / this.half;
    h = lerp(h, -300, smoothstep(0.82, 0.99, edge));
    return h;
  }

  _generate() {
    const { res, heights, half, cell } = this;
    for (let j = 0; j < res; j++) {
      const z = -half + j * cell;
      for (let i = 0; i < res; i++) heights[j * res + i] = this._height(-half + i * cell, z);
    }
  }

  /** Forest density (> 0.47 = woodland); shared with the instanced forest. */
  forestAt(x, z) {
    return fbm2(x / 2600 + 3.1, z / 2600 - 1.7, 3, this.seed + 909);
  }

  /** Bilinear height lookup matching the rendered grid. */
  heightAt(x, z) {
    const { res, heights, half, cell } = this;
    const fx = clamp((x + half) / cell, 0, res - 1.001);
    const fz = clamp((z + half) / cell, 0, res - 1.001);
    const ix = fx | 0;
    const iz = fz | 0;
    const tx = fx - ix;
    const tz = fz - iz;
    const i = iz * res + ix;
    const a = heights[i];
    const b = heights[i + 1];
    const c = heights[i + res];
    const d = heights[i + res + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  /** Ground or sea surface height. */
  surfaceAt(x, z) {
    const h = this.heightAt(x, z);
    return h > 0 ? h : 0;
  }

  /** Finds a land position near (x,z) above minHeight; returns null if none. */
  findLand(x, z, radius, minHeight = 5, maxHeight = 600, rand = Math.random) {
    for (let k = 0; k < 40; k++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      const h = this.heightAt(px, pz);
      if (h > minHeight && h < maxHeight && this.slopeAt(px, pz) < 0.35) return { x: px, z: pz, y: h };
    }
    return null;
  }

  findSea(x, z, radius, rand = Math.random) {
    for (let k = 0; k < 40; k++) {
      const a = rand() * Math.PI * 2;
      const r = Math.sqrt(rand()) * radius;
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (this.heightAt(px, pz) < -25) return { x: px, z: pz, y: 0 };
    }
    return null;
  }

  slopeAt(x, z) {
    const e = this.cell;
    const dx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const dz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    return Math.sqrt(dx * dx + dz * dz) / (2 * e);
  }

  _buildMesh() {
    const { res, heights, half, cell, palette: P } = this;
    const count = res * res;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const n = new THREE.Vector3();
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const k = j * res + i;
        const h = heights[k];
        pos[k * 3] = -half + i * cell;
        pos[k * 3 + 1] = h;
        pos[k * 3 + 2] = -half + j * cell;
        const hl = heights[j * res + Math.max(0, i - 1)];
        const hr = heights[j * res + Math.min(res - 1, i + 1)];
        const hd = heights[Math.max(0, j - 1) * res + i];
        const hu = heights[Math.min(res - 1, j + 1) * res + i];
        n.set(hl - hr, 2 * cell, hd - hu).normalize();
        nor.set([n.x, n.y, n.z], k * 3);
        let c;
        if (h < 0) c = P.seabed;
        else {
          const t = smoothstep(60, 650, h);
          c = [lerp(P.low[0], P.high[0], t), lerp(P.low[1], P.high[1], t), lerp(P.low[2], P.high[2], t)];
          // Woodland reads as darker canopy from altitude.
          if (P.trees && h > 14 && h < P.trees) {
            const w = smoothstep(0.45, 0.58, this.forestAt(-half + i * cell, -half + j * cell)) * (1 - smoothstep(P.trees * 0.8, P.trees, h));
            c = [lerp(c[0], c[0] * 0.5, w), lerp(c[1], c[1] * 0.72, w), lerp(c[2], c[2] * 0.55, w)];
          }
        }
        col.set(c, k * 3);
      }
    }
    const idx = new Uint32Array((res - 1) * (res - 1) * 6);
    let o = 0;
    for (let j = 0; j < res - 1; j++) {
      for (let i = 0; i < res - 1; i++) {
        const a = j * res + i;
        const b = a + 1;
        const c = a + res;
        const d = c + 1;
        idx[o++] = a;
        idx[o++] = c;
        idx[o++] = b;
        idx[o++] = b;
        idx[o++] = c;
        idx[o++] = d;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    // Shader-side detail: rock strata on slopes, snow above the snow line,
    // beaches and wet sand, field patchwork, close-range bump detail and
    // cloud shadows drifting across the ground.
    this.uniforms = {
      uTime: { value: 0 },
      uCloudShadow: { value: 0.35 },
      uSnowLine: { value: P.snowLine },
      uRock: { value: new THREE.Color().setRGB(...P.rock) },
      uSnow: { value: new THREE.Color().setRGB(...P.snow) },
      uSand: { value: new THREE.Color().setRGB(...P.sand) },
      uFields: { value: P.fields ?? 1 },
      uLightMap: { value: this.lightMap },
      uMapHalf: { value: this.half },
    };
    const U = this.uniforms;
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, U);
      ATMO.patch(shader);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;\nvarying vec3 vTerrainN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTerrainN = normal;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vTerrainPos;
          varying vec3 vTerrainN;
          uniform float uTime, uCloudShadow, uSnowLine, uFields;
          uniform vec3 uRock, uSnow, uSand;
          uniform sampler2D uLightMap;
          uniform float uMapHalf;
          float gRock;
          float gSnow;
          ${NOISE}`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            vec3 P = vTerrainPos;
            vec3 N = normalize(vTerrainN);
            float dist = length(P - cameraPosition);
            float slope = 1.0 - N.y;
            float n1 = fbm(P.xz * 0.0032);
            float n2 = vnoise(P.xz * 0.045);
            float n3 = vnoise(P.xz * 0.4) * (1.0 - smoothstep(250.0, 1400.0, dist));
            vec3 base = diffuseColor.rgb * (0.72 + 0.5 * n1 + 0.14 * n2 + 0.1 * n3);
            // Field patchwork on low, flat land.
            vec2 cell = floor(P.xz / vec2(210.0, 160.0) + vec2(n1 * 1.5));
            float field = hash12(cell);
            float farmland = uFields * smoothstep(20.0, 50.0, P.y) * (1.0 - smoothstep(250.0, 420.0, P.y)) * (1.0 - smoothstep(0.04, 0.1, slope)) * step(0.35, hash12(floor(P.xz / 1400.0)));
            vec3 crop = base * mix(vec3(1.25, 1.12, 0.62), vec3(0.75, 1.0, 0.7), step(0.5, field)) * (0.85 + 0.3 * hash12(cell + 7.0));
            base = mix(base, crop, farmland * 0.75);
            // Rock strata on steep slopes.
            gRock = smoothstep(0.16 + n2 * 0.1, 0.3 + n2 * 0.1, slope);
            float strata = 0.82 + 0.18 * sin(P.y * 0.32 + n1 * 7.0 + n2 * 2.0);
            base = mix(base, uRock * strata * (0.78 + 0.45 * n2 + 0.15 * n3), gRock);
            // Snow above the snow line, flat enough to stick.
            gSnow = smoothstep(uSnowLine - 160.0 + n1 * 260.0, uSnowLine + 80.0 + n1 * 260.0, P.y) * (1.0 - smoothstep(0.32, 0.55, slope + n2 * 0.08));
            base = mix(base, uSnow * (0.92 + 0.08 * n2), gSnow);
            // Beaches, wet sand, and the dark seabed.
            float beach = (1.0 - smoothstep(3.0, 12.0 + n2 * 10.0, P.y)) * (1.0 - gRock) * step(-2.0, P.y);
            base = mix(base, uSand * (0.9 + 0.2 * n3), beach);
            base *= mix(0.62, 1.0, smoothstep(-0.5, 2.5, P.y));
            base *= mix(0.4, 1.0, smoothstep(-40.0, 0.0, P.y));
            // Drifting cloud shadows.
            float cs = smoothstep(0.5, 0.72, fbm(P.xz * 0.00021 + vec2(uTime * 0.0035, uTime * 0.0018)));
            base *= 1.0 - cs * uCloudShadow;
            diffuseColor.rgb = base;
          }`,
        )
        .replace(
          '#include <lights_fragment_end>',
          `#include <lights_fragment_end>
          {
            // Baked mountain shadows (R) and ambient occlusion (G).
            vec2 luv = clamp((vTerrainPos.xz + uMapHalf) / (2.0 * uMapHalf), 0.0, 1.0);
            vec4 lm = texture2D(uLightMap, luv);
            reflectedLight.directDiffuse *= lm.r;
            reflectedLight.directSpecular *= lm.r;
            reflectedLight.indirectDiffuse *= 0.35 + 0.65 * lm.g;
          }`,
        )
        .replace(
          '#include <roughnessmap_fragment>',
          `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor - gSnow * 0.35 - (1.0 - smoothstep(-0.5, 2.0, vTerrainPos.y)) * 0.5, 0.25, 1.0);`,
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          {
            float fade = 1.0 - smoothstep(150.0, 1600.0, length(vTerrainPos - cameraPosition));
            if (fade > 0.001) {
              vec2 q = vTerrainPos.xz * 0.055;
              float h0 = vnoise(q) + 0.5 * vnoise(q * 2.7);
              float hx = vnoise(q + vec2(0.35, 0.0)) + 0.5 * vnoise((q + vec2(0.35, 0.0)) * 2.7);
              float hz = vnoise(q + vec2(0.0, 0.35)) + 0.5 * vnoise((q + vec2(0.0, 0.35)) * 2.7);
              vec3 gW = vec3(hx - h0, 0.0, hz - h0) * (0.9 + gRock * 1.8) * (1.0 - gSnow * 0.6) * fade;
              normal = normalize(normal - (viewMatrix * vec4(gW, 0.0)).xyz);
            }
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'terrain-v2';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Bakes sun visibility (soft mountain shadows) and horizon-based ambient
   * occlusion into a small texture. The sun never moves during a mission, so
   * this costs nothing per frame.
   */
  _bakeLight(sunDir) {
    const L = 256;
    const data = new Uint8Array(L * L * 4);
    const step = this.size / (L - 1);
    const sun = sunDir && sunDir.y > 0.02 ? sunDir : null;
    let sx = 0;
    let sz = 0;
    let tanE = 0;
    if (sun) {
      const hl = Math.hypot(sun.x, sun.z) || 1;
      sx = sun.x / hl;
      sz = sun.z / hl;
      tanE = sun.y / hl;
    }
    const dirs = 8;
    const aoDist = [60, 160, 380, 800];
    for (let j = 0; j < L; j++) {
      const z = -this.half + j * step;
      for (let i = 0; i < L; i++) {
        const x = -this.half + i * step;
        const h = this.heightAt(x, z);
        let vis = 1;
        if (sun && h > -5) {
          // March towards the sun; penumbra from the closest miss.
          let minClear = Infinity;
          for (let k = 1; k <= 48; k++) {
            const t = k * k * 4 + k * 40;
            if (t > 9000) break;
            const ray = Math.max(h, 0) + 3 + t * tanE;
            const ground = this.heightAt(x + sx * t, z + sz * t);
            const clear = (ray - ground) / (t * 0.035 + 8);
            if (clear < minClear) minClear = clear;
            if (ray > 2600) break;
          }
          vis = smoothstep(-0.6, 1, minClear);
        }
        let occ = 0;
        if (h > -5) {
          for (let d = 0; d < dirs; d++) {
            const a = (d / dirs) * Math.PI * 2;
            const cx = Math.cos(a);
            const cz = Math.sin(a);
            let maxSlope = 0;
            for (const r of aoDist) {
              const s = (this.heightAt(x + cx * r, z + cz * r) - h) / r;
              if (s > maxSlope) maxSlope = s;
            }
            occ += maxSlope / Math.sqrt(1 + maxSlope * maxSlope);
          }
          occ /= dirs;
        }
        const o = (j * L + i) * 4;
        data[o] = Math.round(clamp(vis, 0, 1) * 255);
        data[o + 1] = Math.round(clamp(1 - occ * 1.4, 0, 1) * 255);
        data[o + 3] = 255;
      }
    }
    const t = new THREE.DataTexture(data, L, L, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  /** Water depth (0 = shore, 1 = 40 m+) for shoreline foam and shallow colour. */
  _buildDepthTexture() {
    const { res, heights } = this;
    const data = new Uint8Array(res * res);
    for (let i = 0; i < data.length; i++) data[i] = Math.round(clamp(-heights[i] / 40, 0, 1) * 255);
    const t = new THREE.DataTexture(data, res, res, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    return t;
  }

  update(time) {
    this.uniforms.uTime.value = time;
  }

  dispose() {
    this.lightMap.dispose();
    this.depthTexture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
