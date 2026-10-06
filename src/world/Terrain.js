import * as THREE from 'three';
import { fbm2, valueNoise, clamp, smoothstep, lerp } from '../core/math.js';
import { NOISE } from './glsl.js';

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
  temperate: { sand: [0.62, 0.56, 0.42], low: [0.22, 0.32, 0.14], high: [0.16, 0.22, 0.11], rock: [0.36, 0.34, 0.31], snow: [0.9, 0.92, 0.95], snowLine: 1300, seabed: [0.12, 0.2, 0.22] },
  alpine: { sand: [0.45, 0.42, 0.36], low: [0.2, 0.3, 0.13], high: [0.14, 0.2, 0.1], rock: [0.33, 0.32, 0.31], snow: [0.92, 0.94, 0.97], snowLine: 1150, seabed: [0.1, 0.16, 0.18] },
  desert: { sand: [0.72, 0.58, 0.38], low: [0.68, 0.52, 0.33], high: [0.6, 0.43, 0.27], rock: [0.5, 0.36, 0.24], snow: [0.75, 0.62, 0.45], snowLine: 99999, seabed: [0.3, 0.28, 0.2] },
  arctic: { sand: [0.55, 0.56, 0.58], low: [0.78, 0.8, 0.84], high: [0.86, 0.88, 0.92], rock: [0.32, 0.33, 0.36], snow: [0.95, 0.96, 0.99], snowLine: 300, seabed: [0.08, 0.14, 0.18] },
};

export class Terrain {
  constructor({ size = 32000, res = 256, seed = 1, type = 'islands', flatZones = [] }) {
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
    this.mesh = this._buildMesh();
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
        const slope = 1 - n.y;
        let c;
        if (h < 0) c = P.seabed;
        else if (h < 18) c = P.sand;
        else {
          const t = smoothstep(80, 700, h);
          c = [lerp(P.low[0], P.high[0], t), lerp(P.low[1], P.high[1], t), lerp(P.low[2], P.high[2], t)];
          const rock = smoothstep(0.12, 0.3, slope);
          c = [lerp(c[0], P.rock[0], rock), lerp(c[1], P.rock[1], rock), lerp(c[2], P.rock[2], rock)];
          const snow = smoothstep(P.snowLine - 120, P.snowLine + 150, h) * (1 - smoothstep(0.35, 0.55, slope));
          c = [lerp(c[0], P.snow[0], snow), lerp(c[1], P.snow[1], snow), lerp(c[2], P.snow[2], snow)];
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

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    // World-space detail noise so the ground never looks like flat vertex colour.
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainPos;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTerrainPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainPos;\n${NOISE}`)
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          {
            float d1 = fbm(vTerrainPos.xz * 0.004);
            float d2 = vnoise(vTerrainPos.xz * 0.05);
            float fields = step(0.55, hash12(floor(vTerrainPos.xz / 180.0))) * smoothstep(20.0, 60.0, vTerrainPos.y) * (1.0 - smoothstep(300.0, 500.0, vTerrainPos.y));
            diffuseColor.rgb *= 0.78 + 0.4 * d1 + 0.12 * d2;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.15, 1.1, 0.8), fields * 0.35);
            diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(-40.0, 0.0, vTerrainPos.y));
          }`,
        );
    };
    mat.customProgramCacheKey = () => 'terrain-v1';
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'terrain';
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
