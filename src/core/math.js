import * as THREE from 'three';

// Shared math helpers. Everything here is allocation-free once loaded: callers
// pass in their own output objects or use the module-level scratch values
// (only valid until the next call that uses the same scratch).

export const UP = Object.freeze(new THREE.Vector3(0, 1, 0));
export const FWD = Object.freeze(new THREE.Vector3(0, 0, -1));
export const RIGHT = Object.freeze(new THREE.Vector3(1, 0, 0));
export const G = 9.81;
export const DEG = Math.PI / 180;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const sign = (v) => (v < 0 ? -1 : 1);
export const wrapAngle = (a) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Small deterministic PRNG (mulberry32). */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fast non-allocating random helpers on Math.random.
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randSign = () => (Math.random() < 0.5 ? -1 : 1);

/** Writes a random unit vector into out. */
export function randomUnit(out) {
  const u = Math.random() * 2 - 1;
  const t = Math.random() * Math.PI * 2;
  const s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(t), u, s * Math.sin(t));
}

/** Returns closest-approach parameter t∈[0,1] of segment p0→p1 to point c. */
export function segmentPointT(p0x, p0y, p0z, dx, dy, dz, cx, cy, cz) {
  const len2 = dx * dx + dy * dy + dz * dz;
  if (len2 < 1e-9) return 0;
  const t = ((cx - p0x) * dx + (cy - p0y) * dy + (cz - p0z) * dz) / len2;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Squared distance between segment (p0, p0+d) and point c. */
export function segmentPointDist2(p0x, p0y, p0z, dx, dy, dz, cx, cy, cz) {
  const t = segmentPointT(p0x, p0y, p0z, dx, dy, dz, cx, cy, cz);
  const x = p0x + dx * t - cx;
  const y = p0y + dy * t - cy;
  const z = p0z + dz * t - cz;
  return x * x + y * y + z * z;
}

/**
 * Squared distance between two segments (p1,p1+d1) and (p2,p2+d2).
 * Used for bullet-vs-capsule tests. Allocation free.
 */
export function segmentSegmentDist2(p1x, p1y, p1z, d1x, d1y, d1z, p2x, p2y, p2z, d2x, d2y, d2z) {
  const rx = p1x - p2x;
  const ry = p1y - p2y;
  const rz = p1z - p2z;
  const a = d1x * d1x + d1y * d1y + d1z * d1z;
  const e = d2x * d2x + d2y * d2y + d2z * d2z;
  const f = d2x * rx + d2y * ry + d2z * rz;
  let s;
  let t;
  if (a <= 1e-9 && e <= 1e-9) {
    s = t = 0;
  } else if (a <= 1e-9) {
    s = 0;
    t = clamp(f / e, 0, 1);
  } else {
    const c = d1x * rx + d1y * ry + d1z * rz;
    if (e <= 1e-9) {
      t = 0;
      s = clamp(-c / a, 0, 1);
    } else {
      const b = d1x * d2x + d1y * d2y + d1z * d2z;
      const denom = a * e - b * b;
      s = denom !== 0 ? clamp((b * f - c * e) / denom, 0, 1) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = clamp(-c / a, 0, 1);
      } else if (t > 1) {
        t = 1;
        s = clamp((b - c) / a, 0, 1);
      }
    }
  }
  const x = p1x + d1x * s - (p2x + d2x * t);
  const y = p1y + d1y * s - (p2y + d2y * t);
  const z = p1z + d1z * s - (p2z + d2z * t);
  return x * x + y * y + z * z;
}

/**
 * First-order intercept: time for a projectile at speed `s` fired from `p`
 * to hit a target at `tp` moving with `tv`. Returns -1 if impossible.
 */
export function interceptTime(px, py, pz, tpx, tpy, tpz, tvx, tvy, tvz, s) {
  const dx = tpx - px;
  const dy = tpy - py;
  const dz = tpz - pz;
  const a = tvx * tvx + tvy * tvy + tvz * tvz - s * s;
  const b = 2 * (dx * tvx + dy * tvy + dz * tvz);
  const c = dx * dx + dy * dy + dz * dz;
  if (Math.abs(a) < 1e-6) return c > 0 && b < 0 ? -c / b : Math.sqrt(c) / s;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  const t = t1 > 0 && t2 > 0 ? Math.min(t1, t2) : Math.max(t1, t2);
  return t > 0 ? t : -1;
}

// 2D value noise + fbm in JS, mirrored by the GLSL used for terrain colouring.
function hash2(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iz, 668265263) ^ Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export function valueNoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

export function fbm2(x, z, octaves, seed) {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    v += amp * valueNoise(x * f, z * f, seed + i * 17);
    f *= 2.03;
    amp *= 0.5;
  }
  return v;
}

/** Shared scratch objects. Use only within one synchronous function. */
export const tmp = {
  v1: new THREE.Vector3(),
  v2: new THREE.Vector3(),
  v3: new THREE.Vector3(),
  v4: new THREE.Vector3(),
  v5: new THREE.Vector3(),
  q1: new THREE.Quaternion(),
  q2: new THREE.Quaternion(),
  m1: new THREE.Matrix4(),
  e1: new THREE.Euler(),
  c1: new THREE.Color(),
};
