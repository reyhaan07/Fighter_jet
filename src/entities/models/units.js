import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, liftingSurface } from './geometry.js';

// Procedural models for everything that isn't a fighter: bombers,
// helicopters, ground vehicles, air defences, ships, the flying fortress and
// all ordnance. Each builder returns LOD levels [{ geometry, dist }] with
// vertex colours; white parts take the per-instance team colour.
// Model space: forward → -Z, up → +Y, metres.

const C = {
  white: [1, 1, 1],
  dark: [0.18, 0.19, 0.2],
  metal: [0.45, 0.46, 0.47],
  glass: [0.12, 0.16, 0.2],
  black: [0.04, 0.04, 0.045],
  deck: [0.24, 0.25, 0.26],
  hull: [0.42, 0.44, 0.47],
  red: [0.8, 0.12, 0.08],
  glow: [3, 1.4, 0.5],
  warn: [0.9, 0.7, 0.15],
  olive: [0.32, 0.35, 0.22],
};

function part(geo, color, matrix) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (matrix) g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(color, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

function merge(parts) {
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  g.computeBoundingSphere();
  return g;
}

const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const box = (w, h, d, color, x = 0, y = 0, z = 0, m = null) => part(new THREE.BoxGeometry(w, h, d), color, m ? T(x, y, z).multiply(m) : T(x, y, z));
const cyl = (r1, r2, h, seg, color, m) => part(new THREE.CylinderGeometry(r1, r2, h, seg), color, m);
const rotX = (a) => new THREE.Matrix4().makeRotationX(a);
const rotY = (a) => new THREE.Matrix4().makeRotationY(a);
const rotZ = (a) => new THREE.Matrix4().makeRotationZ(a);

/** A proxy box for far LODs. */
function proxy(w, h, d, color = C.white, y = 0) {
  return merge([box(w, h, d, color, 0, y, 0)]);
}

function wingPair(def, color, lowDetail) {
  const d = { rootThickness: 0.08, tipThickness: 0.05, spanSegments: lowDetail ? 1 : 4, chordSegments: lowDetail ? 3 : 8, ...def };
  return [part(liftingSurface(d), color), part(liftingSurface({ ...d, mirror: true }), color)];
}

// ── Aircraft ─────────────────────────────────────────────────────────────
function bomber(low) {
  const L = low ? { radial: 10, rings: 10 } : { radial: 24, rings: 36 };
  const parts = [
    part(
      loft(
        [
          { z: -22, w: 0.2, ht: 0.2, hb: 0.2, y: 0, n: 2 },
          { z: -18, w: 2.4, ht: 2.2, hb: 2.0, y: 0, n: 2.2 },
          { z: -8, w: 3.4, ht: 3.0, hb: 2.8, y: 0, n: 2.4 },
          { z: 10, w: 3.2, ht: 3.0, hb: 2.6, y: 0.2, n: 2.4 },
          { z: 20, w: 1.2, ht: 1.4, hb: 0.8, y: 1.4, n: 2.2 },
        ],
        { ...L, capEnd: true },
      ),
      C.white,
    ),
    ...wingPair({ rootLE: [2.5, 1.5, -6], rootChord: 11, tipLE: [30, 1.8, 2], tipChord: 4.5, rootThickness: 0.1, tipThickness: 0.06 }, C.white, low),
    ...wingPair({ rootLE: [0.8, 1.8, 13], rootChord: 6, tipLE: [10, 2, 18], tipChord: 2.5 }, C.white, low),
    part(liftingSurface({ rootLE: [0, 0, 11], rootChord: 8, tipLE: [10, 0, 19], tipChord: 3, rootThickness: 0.08, tipThickness: 0.05, spanSegments: 2, chordSegments: low ? 3 : 8 }), C.white, T(0, 2.2, 0).multiply(rotZ(Math.PI / 2))),
    part(new THREE.SphereGeometry(1.6, low ? 6 : 14, low ? 4 : 8, 0, Math.PI * 2, 0, Math.PI / 2), C.glass, T(0, 1.9, -16).multiply(new THREE.Matrix4().makeScale(1, 0.6, 1.6))),
  ];
  for (const x of [-9, -17, 9, 17]) {
    parts.push(cyl(1.1, 0.95, 6, low ? 6 : 14, C.dark, T(x, 0.6, -3.5 + Math.abs(x) * 0.12).multiply(rotX(Math.PI / 2))));
    if (!low) parts.push(part(new THREE.CircleGeometry(0.85, 12), C.glow, T(x, 0.6, -0.5 + Math.abs(x) * 0.12)));
  }
  return merge(parts);
}

function transport(low) {
  const L = low ? { radial: 10, rings: 10 } : { radial: 22, rings: 30 };
  const parts = [
    part(
      loft(
        [
          { z: -16, w: 0.3, ht: 0.3, hb: 0.3, y: -0.5, n: 2 },
          { z: -13, w: 2.6, ht: 2.4, hb: 2.4, y: 0, n: 2.2 },
          { z: 8, w: 2.8, ht: 2.6, hb: 2.6, y: 0, n: 2.3 },
          { z: 16, w: 0.8, ht: 1, hb: 0.6, y: 1.8, n: 2.2 },
        ],
        { ...L, capEnd: true },
      ),
      C.white,
    ),
    ...wingPair({ rootLE: [2, 2.4, -4], rootChord: 6, tipLE: [22, 2.4, -1.5], tipChord: 3 }, C.white, low),
    ...wingPair({ rootLE: [0.5, 2.4, 12], rootChord: 4, tipLE: [8, 2.6, 15], tipChord: 2 }, C.white, low),
    part(liftingSurface({ rootLE: [0, 0, 10], rootChord: 6, tipLE: [8, 0, 15], tipChord: 2.5, rootThickness: 0.08, tipThickness: 0.05, spanSegments: 2, chordSegments: 4 }), C.white, T(0, 2.5, 0).multiply(rotZ(Math.PI / 2))),
  ];
  for (const x of [-8, 8]) parts.push(cyl(1.2, 1.2, 5, low ? 6 : 14, C.dark, T(x, 1.8, -4).multiply(rotX(Math.PI / 2))));
  return merge(parts);
}

function heli(low) {
  const s = low ? 6 : 14;
  const parts = [
    part(
      loft(
        [
          { z: -5, w: 0.4, ht: 0.6, hb: 0.6, y: 0, n: 2 },
          { z: -3.5, w: 1.1, ht: 1.2, hb: 1.1, y: 0, n: 2.4 },
          { z: 1.5, w: 1.2, ht: 1.3, hb: 1.0, y: 0.1, n: 2.6 },
          { z: 3.5, w: 0.5, ht: 0.6, hb: 0.3, y: 0.6, n: 2.2 },
          { z: 10, w: 0.22, ht: 0.25, hb: 0.15, y: 0.9, n: 2 },
        ],
        { radial: low ? 8 : 18, rings: low ? 8 : 20, capEnd: true },
      ),
      C.white,
    ),
    part(new THREE.SphereGeometry(1, s, s / 2), C.glass, T(0, 0.3, -3.6).multiply(new THREE.Matrix4().makeScale(0.8, 0.8, 1.2))),
    box(0.15, 1.8, 1.2, C.white, 0, 1.6, 9.6),
    box(5, 0.12, 0.6, C.dark, 0, 0.0, 0.5),
    cyl(0.2, 0.2, 1, 8, C.dark, T(0, 1.6, 0)),
    // Rotor disc (motion-blurred) and tail rotor.
    cyl(7, 7, 0.05, low ? 10 : 28, C.black, T(0, 2.1, 0)),
    cyl(1.1, 1.1, 0.05, 12, C.black, T(0.25, 1.6, 9.8).multiply(rotZ(Math.PI / 2))),
  ];
  if (!low) for (const x of [-2.4, 2.4]) parts.push(cyl(0.22, 0.22, 2.2, 8, C.metal, T(x, -0.3, 0.3).multiply(rotX(Math.PI / 2))));
  return merge(parts);
}

// ── Ground ───────────────────────────────────────────────────────────────
function tank(low) {
  const p = [box(3.6, 1.2, 7, C.white, 0, 0.9, 0), box(4, 0.9, 7.4, C.dark, 0, 0.45, 0)];
  if (!low) {
    p.push(part(new THREE.CylinderGeometry(1.6, 1.8, 1, 10), C.white, T(0, 1.9, 0.4)));
    p.push(cyl(0.16, 0.16, 5, 8, C.dark, T(0, 1.95, -3.2).multiply(rotX(Math.PI / 2))));
  } else p.push(box(2.6, 0.9, 3, C.white, 0, 1.9, 0.4));
  return merge(p);
}

function truck(low) {
  const p = [box(2.4, 1.8, 2.2, C.white, 0, 1.4, -2.6), box(2.4, 2.2, 5, C.olive, 0, 1.6, 1.2)];
  if (!low) for (const z of [-2.6, 0.4, 2.6]) for (const x of [-1.2, 1.2]) p.push(cyl(0.5, 0.5, 0.4, 10, C.black, T(x, 0.5, z).multiply(rotZ(Math.PI / 2))));
  return merge(p);
}

function sam(low) {
  const p = [box(3, 1.6, 8, C.white, 0, 1.2, 0), box(3.2, 0.8, 8.4, C.dark, 0, 0.4, 0)];
  const rack = new THREE.Matrix4().makeRotationX(0.7);
  for (const x of [-0.75, 0.75]) for (const y of [0, 0.75]) p.push(cyl(0.32, 0.32, 6, low ? 5 : 10, C.metal, T(x, 2.8 + y, 1.2).multiply(rack).multiply(rotX(Math.PI / 2))));
  if (!low) p.push(cyl(1.4, 1.4, 0.2, 14, C.dark, T(0, 3.2, -3).multiply(rotX(-1))));
  return merge(p);
}

function aa(low) {
  const p = [cyl(2.6, 3, 1, low ? 6 : 14, C.dark, T(0, 0.5, 0)), box(2.4, 1.6, 2.6, C.white, 0, 1.8, 0)];
  const up = new THREE.Matrix4().makeRotationX(0.9);
  for (const x of [-0.5, 0.5]) p.push(cyl(0.13, 0.13, 4.5, 6, C.black, T(x, 2.6, -1).multiply(up).multiply(rotX(Math.PI / 2))));
  return merge(p);
}

function radar(low) {
  const p = [cyl(0.6, 1, 14, 8, C.metal, T(0, 7, 0)), box(6, 3, 6, C.white, 0, 1.5, 0)];
  p.push(part(new THREE.SphereGeometry(4, low ? 6 : 16, low ? 4 : 8, 0, Math.PI * 2, 0, Math.PI / 2.6), C.white, T(0, 13, 0).multiply(rotX(-1.2))));
  return merge(p);
}

function bunker(low) {
  const p = [part(new THREE.SphereGeometry(9, low ? 6 : 16, low ? 4 : 8, 0, Math.PI * 2, 0, Math.PI / 2), C.white, new THREE.Matrix4().makeScale(1.4, 0.55, 1)), box(6, 1, 0.4, C.black, 0, 2.6, -8.7)];
  return merge(p);
}

function factory(low) {
  const p = [box(40, 14, 26, C.white, 0, 7, 0), box(16, 22, 12, C.white, 14, 11, 8)];
  if (!low) {
    for (const x of [-12, -4]) p.push(cyl(1.6, 2, 30, 10, C.dark, T(x, 15, 9)));
    p.push(box(42, 1.5, 28, C.dark, 0, 14.5, 0));
  }
  return merge(p);
}

function fuelTank(low) {
  return merge([cyl(8, 8, 10, low ? 8 : 20, C.white, T(0, 5, 0)), cyl(8.2, 8.2, 0.6, low ? 8 : 20, C.dark, T(0, 10, 0))]);
}

function building(low) {
  const p = [box(18, 30, 18, C.white, 0, 15, 0)];
  if (!low) p.push(box(19, 1, 19, C.dark, 0, 30, 0), box(6, 6, 6, C.dark, 3, 33, 2));
  return merge(p);
}

// ── Ships ────────────────────────────────────────────────────────────────
function hullGeo(len, beam, depth, low) {
  const h = len / 2;
  return part(
    loft(
      [
        { z: -h, w: 0.4, ht: depth * 0.6, hb: depth * 0.4, y: depth * 0.35, n: 2 },
        { z: -h * 0.6, w: beam * 0.42, ht: depth * 0.5, hb: depth * 0.5, y: depth * 0.2, n: 3 },
        { z: 0, w: beam * 0.5, ht: depth * 0.5, hb: depth * 0.5, y: 0, n: 4 },
        { z: h * 0.85, w: beam * 0.45, ht: depth * 0.5, hb: depth * 0.4, y: 0, n: 4 },
        { z: h, w: beam * 0.38, ht: depth * 0.45, hb: depth * 0.2, y: 0.2, n: 4 },
      ],
      { radial: low ? 10 : 24, rings: low ? 8 : 28, capEnd: true },
    ),
    C.hull,
  );
}

function frigate(low) {
  const p = [hullGeo(110, 14, 10, low), box(9, 7, 22, C.white, 0, 8, 6), box(6, 5, 10, C.white, 0, 13, 4)];
  if (!low) {
    p.push(cyl(0.5, 0.8, 16, 6, C.dark, T(0, 22, 4)));
    p.push(box(4, 2.5, 5, C.white, 0, 6.5, -30), cyl(0.25, 0.25, 6, 6, C.dark, T(0, 7, -35).multiply(rotX(Math.PI / 2))));
    p.push(box(5, 3, 6, C.dark, 0, 6.5, 30));
  }
  return merge(p);
}

function destroyer(low) {
  const p = [hullGeo(150, 18, 12, low), box(12, 9, 30, C.white, 0, 10, 4), box(8, 7, 14, C.white, 0, 17, 0), box(5, 3, 8, C.white, 0, 22, -2)];
  if (!low) {
    p.push(cyl(0.6, 1, 20, 6, C.dark, T(0, 30, 0)));
    for (const z of [-42, -32]) p.push(box(5, 3, 6, C.white, 0, 8, z), cyl(0.3, 0.3, 7, 6, C.dark, T(0, 8.5, z - 5).multiply(rotX(Math.PI / 2))));
    p.push(box(8, 1.5, 14, C.dark, 0, 7.5, 45));
  }
  return merge(p);
}

function carrier(low) {
  const p = [hullGeo(320, 44, 22, low), box(70, 2, 320, C.deck, 0, 12, 0), box(16, 26, 46, C.white, 26, 26, 30)];
  if (!low) {
    p.push(box(10, 14, 14, C.white, 26, 46, 30), cyl(1, 1.4, 20, 8, C.dark, T(26, 58, 30)));
    p.push(box(1, 0.1, 280, C.warn, 0, 13.1, 0), box(1, 0.1, 140, C.warn, -14, 13.1, -70, rotY(-0.17)));
  }
  return merge(p);
}

// ── Boss: the flying fortress (hull only; turrets/engines are separate units) ──
function fortress(low) {
  const p = [];
  const d = { rootThickness: 0.12, tipThickness: 0.06, spanSegments: low ? 2 : 8, chordSegments: low ? 4 : 14 };
  p.push(part(liftingSurface({ ...d, rootLE: [8, 0, -70], rootChord: 120, tipLE: [115, 0, 10], tipChord: 22 }), C.white));
  p.push(part(liftingSurface({ ...d, mirror: true, rootLE: [8, 0, -70], rootChord: 120, tipLE: [115, 0, 10], tipChord: 22 }), C.white));
  p.push(
    part(
      loft(
        [
          { z: -80, w: 2, ht: 2, hb: 2, y: 0, n: 2 },
          { z: -60, w: 14, ht: 10, hb: 7, y: 0, n: 2.6 },
          { z: 0, w: 20, ht: 14, hb: 9, y: 0, n: 3 },
          { z: 45, w: 14, ht: 9, hb: 6, y: 0, n: 3 },
          { z: 55, w: 6, ht: 4, hb: 3, y: 0, n: 2.6 },
        ],
        { radial: low ? 10 : 32, rings: low ? 8 : 30, capEnd: true },
      ),
      C.white,
    ),
  );
  p.push(box(6, 3, 16, C.glass, 0, 12, -45));
  if (!low) for (const x of [-60, -30, 30, 60]) p.push(box(3, 18, 10, C.dark, x, -9, 0));
  return merge(p);
}

function fortressEngine(low) {
  return merge([cyl(5, 6, 22, low ? 8 : 18, C.dark, rotX(Math.PI / 2)), part(new THREE.CircleGeometry(4.6, low ? 8 : 18), C.glow, T(0, 0, 11.05))]);
}

function fortressCore(low) {
  return merge([part(new THREE.SphereGeometry(6, low ? 8 : 20, low ? 6 : 12), [2.4, 0.4, 0.3]), cyl(7.5, 7.5, 1.5, low ? 8 : 24, C.dark)]);
}

function turret(low) {
  const p = [cyl(2.2, 2.6, 2, low ? 6 : 14, C.dark), box(2.6, 1.6, 3, C.white, 0, 1.6, 0)];
  for (const x of [-0.5, 0.5]) p.push(cyl(0.15, 0.15, 4, 6, C.black, T(x, 1.7, -2.6).multiply(rotX(Math.PI / 2))));
  return merge(p);
}

// ── Ordnance ─────────────────────────────────────────────────────────────
function missile(low, len = 3.6, r = 0.1) {
  const s = low ? 5 : 10;
  const p = [cyl(r, r, len, s, C.white, rotX(Math.PI / 2)), part(new THREE.ConeGeometry(r, len * 0.16, s), C.metal, T(0, 0, -len * 0.58).multiply(rotX(-Math.PI / 2)))];
  if (!low) for (let i = 0; i < 4; i++) p.push(box(r * 4.5, 0.02, len * 0.12, C.metal, 0, 0, len * 0.42, rotZ((i * Math.PI) / 2 + Math.PI / 4)));
  return merge(p);
}

function bomb(low) {
  const s = low ? 6 : 12;
  const p = [part(new THREE.SphereGeometry(0.28, s, s / 2), C.white, new THREE.Matrix4().makeScale(1, 1, 4.2))];
  if (!low) for (let i = 0; i < 4; i++) p.push(box(0.6, 0.02, 0.4, C.dark, 0, 0, 1.2, rotZ((i * Math.PI) / 2)));
  return merge(p);
}

function cruise(low) {
  const p = [cyl(0.32, 0.32, 6, low ? 6 : 12, C.white, rotX(Math.PI / 2)), part(new THREE.ConeGeometry(0.32, 1.1, 12), C.metal, T(0, 0, -3.5).multiply(rotX(-Math.PI / 2)))];
  p.push(box(4.2, 0.05, 0.6, C.white, 0, 0, 0.2));
  p.push(box(0.05, 0.9, 0.6, C.white, 0, 0.4, 2.6));
  return merge(p);
}

function droneSmall(low) {
  return merge([part(new THREE.SphereGeometry(0.5, low ? 6 : 12, low ? 4 : 8), C.white, new THREE.Matrix4().makeScale(1, 0.6, 2)), box(3, 0.06, 0.7, C.dark, 0, 0, 0.3), part(new THREE.CircleGeometry(0.3, 10), C.glow, T(0, 0, 1.01))]);
}

// Each entry returns LOD levels; capacity = max instances drawn per level.
const lods = (build, near, far, capacity, proxyDims = null) => () => {
  const levels = [{ geometry: build(false), dist: near }];
  if (far) levels.push({ geometry: proxyDims ? proxy(...proxyDims) : build(true), dist: far });
  levels.capacity = capacity;
  return levels;
};

export const UNIT_MODELS = {
  bomber: lods(bomber, 1500, 30000, 32),
  transport: lods(transport, 1500, 30000, 16),
  heli: lods(heli, 900, 20000, 48),
  tank: lods(tank, 1000, 9000, 96),
  truck: lods(truck, 900, 7000, 96),
  sam: lods(sam, 1200, 12000, 48),
  aa: lods(aa, 1000, 10000, 64),
  radar: lods(radar, 1500, 14000, 16),
  bunker: lods(bunker, 1600, 14000, 24),
  factory: lods(factory, 3000, 20000, 24),
  fuelTank: lods(fuelTank, 2000, 16000, 32),
  building: lods(building, 2500, 18000, 64),
  frigate: lods(frigate, 3000, 30000, 16),
  destroyer: lods(destroyer, 3000, 30000, 12),
  carrier: lods(carrier, 4000, 40000, 2),
  fortress: lods(fortress, 4000, 40000, 2),
  fortressEngine: lods(fortressEngine, 3000, 40000, 8),
  fortressCore: lods(fortressCore, 3000, 40000, 2),
  turret: lods(turret, 2000, 20000, 48),
  missile: lods((l) => missile(l), 500, 6000, 512),
  missileBig: lods((l) => missile(l, 5.5, 0.18), 700, 9000, 64),
  microMissile: lods((l) => missile(l, 1.4, 0.06), 300, 3000, 256),
  rocket: lods((l) => missile(l, 2.2, 0.07), 300, 3000, 256),
  bomb: lods(bomb, 500, 6000, 128),
  cruise: lods(cruise, 800, 9000, 8),
  droneSmall: lods(droneSmall, 500, 6000, 32),
};

export function createUnitMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62, metalness: 0.35 });
}

