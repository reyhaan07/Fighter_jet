import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, liftingSurface, clean } from './geometry.js';
import { createSkinMaterial } from './panelMaterial.js';

// Procedural fighter jets, derived from the portfolio's fifth-generation
// fighter builder (lofted fuselage, caret intakes, NACA lifting surfaces,
// canted tails, petal nozzles, gold canopy). One builder, many designs:
// every playable/enemy jet is a set of parameters below.
//
// Aircraft space: nose → -Z, up → +Y, right → +X. Units are metres.
//
// lod 0 = full detail (player / hangar), 1 = merged mid detail (instanced
// enemies nearby), 2 = low poly (far away).

const SEG = [
  { radial: 64, rings: 110, wingSpan: 14, wingChord: 22, small: true },
  { radial: 20, rings: 28, wingSpan: 4, wingChord: 8, small: true },
  { radial: 8, rings: 9, wingSpan: 1, wingChord: 3, small: false },
];

export const JET_DESIGNS = {
  // Agile fighter: the portfolio jet.
  viper: {
    fuselage: { width: 1, height: 1, length: 1 },
    wing: { rootLE: [1.2, 0.02, -1.6], rootChord: 7.2, tipLE: [7.05, 0.05, 3.55], tipChord: 1.35 },
    lerx: true,
    stab: { rootLE: [1.35, -0.02, 5.7], rootChord: 3.0, tipLE: [4.7, -0.02, 7.55], tipChord: 1.1 },
    tails: { count: 2, cant: 26, scale: 1, x: 1.28 },
    canards: false,
    ventral: true,
    nozzles: 2,
    stores: [3.7],
  },
  // Heavy striker: wide body, big straight-ish wing, four pylons.
  hammer: {
    fuselage: { width: 1.28, height: 1.15, length: 1.08 },
    wing: { rootLE: [1.55, 0.0, -0.9], rootChord: 7.0, tipLE: [8.6, 0.0, 2.2], tipChord: 2.4 },
    lerx: true,
    stab: { rootLE: [1.6, -0.02, 6.2], rootChord: 3.2, tipLE: [5.2, -0.02, 7.6], tipChord: 1.4 },
    tails: { count: 2, cant: 6, scale: 1.15, x: 1.45 },
    canards: false,
    ventral: false,
    nozzles: 2,
    stores: [3.3, 5.6],
  },
  // Stealth jet: flat faceted body, diamond wing, wide V-tail, no stabilators.
  wraith: {
    fuselage: { width: 1.18, height: 0.82, length: 1.0, faceted: true },
    wing: { rootLE: [1.3, 0.04, -3.6], rootChord: 10.4, tipLE: [7.4, 0.06, 3.9], tipChord: 1.2 },
    lerx: false,
    stab: null,
    tails: { count: 2, cant: 52, scale: 1.05, x: 1.15 },
    canards: false,
    ventral: false,
    nozzles: 2,
    stores: [],
  },
  // Interceptor: long nose, delta wing, canards, single tail.
  lancer: {
    fuselage: { width: 0.92, height: 1.0, length: 1.18 },
    wing: { rootLE: [1.05, -0.08, -2.2], rootChord: 9.6, tipLE: [6.0, -0.06, 6.4], tipChord: 0.9 },
    lerx: false,
    stab: null,
    tails: { count: 1, cant: 0, scale: 1.25, x: 0 },
    canards: true,
    ventral: true,
    nozzles: 2,
    stores: [3.4],
  },
  // Light trainer / starter: small, single tail, straight-ish wing.
  kestrel: {
    fuselage: { width: 0.8, height: 0.95, length: 0.82 },
    wing: { rootLE: [0.85, -0.05, -1.4], rootChord: 5.2, tipLE: [5.6, 0.0, 1.6], tipChord: 1.6 },
    lerx: false,
    stab: { rootLE: [0.9, 0.1, 4.6], rootChord: 2.4, tipLE: [3.3, 0.1, 5.8], tipChord: 1.0 },
    tails: { count: 1, cant: 0, scale: 0.95, x: 0 },
    canards: false,
    ventral: false,
    nozzles: 1,
    stores: [3.0],
  },
  // Light multirole: single engine, LERX, single fin.
  falcon: {
    fuselage: { width: 0.88, height: 1.0, length: 0.95 },
    wing: { rootLE: [1.0, 0.0, -1.2], rootChord: 6.4, tipLE: [6.2, 0.04, 3.4], tipChord: 1.3 },
    lerx: true,
    stab: { rootLE: [1.0, -0.02, 5.4], rootChord: 2.8, tipLE: [4.0, -0.02, 7.0], tipChord: 1.0 },
    tails: { count: 1, cant: 0, scale: 1.1, x: 0 },
    canards: false,
    ventral: true,
    nozzles: 1,
    stores: [3.3, 5.0],
  },
  // Canard delta with twin canted fins (European style).
  tempest: {
    fuselage: { width: 0.95, height: 0.95, length: 1.05 },
    wing: { rootLE: [1.1, -0.05, -1.8], rootChord: 9.2, tipLE: [6.6, -0.02, 6.0], tipChord: 1.1 },
    lerx: false,
    stab: null,
    tails: { count: 2, cant: 18, scale: 0.95, x: 1.0 },
    canards: true,
    ventral: false,
    nozzles: 2,
    stores: [3.6],
  },
  // Forward-swept wing super-manoeuvrable fighter.
  griffin: {
    fuselage: { width: 1.05, height: 1.0, length: 1.08 },
    wing: { rootLE: [1.25, 0.0, 0.6], rootChord: 6.2, tipLE: [7.4, 0.06, -0.9], tipChord: 2.0 },
    lerx: true,
    stab: { rootLE: [1.35, -0.02, 6.0], rootChord: 2.8, tipLE: [4.4, -0.02, 7.6], tipChord: 1.0 },
    tails: { count: 2, cant: 14, scale: 1.0, x: 1.3 },
    canards: true,
    ventral: false,
    nozzles: 2,
    stores: [3.8],
  },
  // Big twin-engine air dominance fighter.
  raptor: {
    fuselage: { width: 1.15, height: 1.0, length: 1.12 },
    wing: { rootLE: [1.4, 0.02, -2.2], rootChord: 8.4, tipLE: [7.8, 0.05, 3.4], tipChord: 1.5 },
    lerx: true,
    stab: { rootLE: [1.5, -0.02, 6.0], rootChord: 3.4, tipLE: [5.3, -0.02, 7.9], tipChord: 1.2 },
    tails: { count: 2, cant: 28, scale: 1.1, x: 1.4 },
    canards: false,
    ventral: false,
    nozzles: 2,
    stores: [3.8, 5.8],
  },
  // Flying-wing stealth: no tails at all.
  specter: {
    fuselage: { width: 1.3, height: 0.7, length: 0.9, faceted: true },
    wing: { rootLE: [1.0, 0.05, -5.2], rootChord: 12.5, tipLE: [9.6, 0.06, 3.2], tipChord: 2.4 },
    lerx: false,
    stab: null,
    tails: { count: 0, cant: 0, scale: 1, x: 0 },
    canards: false,
    ventral: false,
    nozzles: 2,
    stores: [],
  },
  // Heavy long-range strike fighter with a wide body.
  titan: {
    fuselage: { width: 1.4, height: 1.2, length: 1.2 },
    wing: { rootLE: [1.7, 0.0, -1.6], rootChord: 8.6, tipLE: [9.2, 0.02, 3.0], tipChord: 2.0 },
    lerx: true,
    stab: { rootLE: [1.8, -0.02, 6.6], rootChord: 3.6, tipLE: [6.0, -0.02, 8.4], tipChord: 1.5 },
    tails: { count: 2, cant: 4, scale: 1.25, x: 1.6 },
    canards: false,
    ventral: true,
    nozzles: 2,
    stores: [3.6, 5.8, 7.6],
  },
  // Enemy drone / training target: small single-engine airframe.
  drone: {
    fuselage: { width: 0.7, height: 0.7, length: 0.6 },
    wing: { rootLE: [0.7, 0.0, -0.4], rootChord: 3.2, tipLE: [4.4, 0.0, 1.2], tipChord: 1.0 },
    lerx: false,
    stab: null,
    tails: { count: 2, cant: 40, scale: 0.55, x: 0.7 },
    canards: false,
    ventral: false,
    nozzles: 1,
    stores: [],
  },
};

function tailMarkingTexture(callsign) {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(210,215,222,0.55)';
  g.font = '600 92px "Barlow Condensed", "Arial Narrow", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(callsign, 256, 110);
  g.fillStyle = 'rgba(210,215,222,0.35)';
  g.font = '500 30px "JetBrains Mono", monospace';
  g.fillText('STRIKE WING', 256, 186);
  g.fillRect(96, 214, 320, 3);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function turbineTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  grd.addColorStop(0, '#fff4e0');
  grd.addColorStop(0.18, '#ffb36b');
  grd.addColorStop(0.45, '#6b2c12');
  grd.addColorStop(1, '#0b0706');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  g.translate(64, 64);
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i < 28; i++) {
    g.rotate((Math.PI * 2) / 28);
    g.beginPath();
    g.moveTo(11, 0);
    g.quadraticCurveTo(35, 11, 62, 4);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function flipWinding(geometry) {
  const idx = geometry.index.array;
  for (let i = 0; i < idx.length; i += 3) {
    const t = idx[i + 1];
    idx[i + 1] = idx[i + 2];
    idx[i + 2] = t;
  }
  geometry.index.needsUpdate = true;
  geometry.computeVertexNormals();
}

/**
 * Builds the airframe as a list of { geometry, part } pieces so the same code
 * produces the detailed multi-material player jet and the merged enemy LODs.
 * part ∈ body | trim | canopy | metal | cavity | nozzleInner | turbine | store | strip
 */
function buildParts(design, lod) {
  const s = SEG[lod];
  const F = design.fuselage;
  const parts = [];
  const add = (geometry, part) => parts.push({ geometry, part });

  const st = (z, w, ht, hb, y, n) => {
    const f = F.faceted ? Math.max(4.5, n * 1.9) : n;
    return { z: z * F.length, w: w * F.width, ht: ht * F.height, hb: hb * F.height * (F.faceted ? 0.7 : 1), y, n: f };
  };
  const noseZ = -8.6 * F.length;
  const tailZ = 7.3 * F.length;

  add(
    loft(
      [
        st(-8.6, 0.015, 0.015, 0.015, -0.02, 2.0),
        st(-7.6, 0.3, 0.24, 0.2, -0.02, 2.1),
        st(-6.3, 0.6, 0.4, 0.36, 0.0, 2.2),
        st(-4.8, 0.82, 0.52, 0.46, 0.04, 2.4),
        st(-3.2, 1.1, 0.58, 0.52, 0.02, 2.6),
        st(-1.4, 1.55, 0.6, 0.56, 0.0, 2.9),
        st(0.8, 1.72, 0.56, 0.6, 0.0, 3.1),
        st(3.4, 1.74, 0.5, 0.56, 0.0, 3.1),
        st(5.6, 1.62, 0.44, 0.5, 0.0, 3.0),
        st(7.3, 1.42, 0.38, 0.44, 0.0, 2.9),
      ],
      { radial: s.radial, rings: s.rings, capEnd: true },
    ),
    'body',
  );

  if (lod < 2) {
    add(
      loft(
        [
          st(-3.6, 0.05, 0.02, 0.02, 0.55 * F.height, 2),
          st(-2.4, 0.48, 0.24, 0.05, 0.56 * F.height, 2.4),
          st(1.5, 0.62, 0.2, 0.05, 0.52 * F.height, 2.6),
          st(5.5, 0.45, 0.1, 0.05, 0.42 * F.height, 2.4),
          st(7.0, 0.3, 0.02, 0.02, 0.36 * F.height, 2),
        ],
        { radial: Math.max(8, s.radial * 0.6) | 0, rings: Math.max(6, s.rings * 0.45) | 0 },
      ),
      'body',
    );
    // Caret intakes.
    const intakeR = loft(
      [
        st(-3.3, 0.36, 0.34, 0.36, -0.14, 5),
        st(-1.2, 0.42, 0.38, 0.4, -0.14, 5),
        st(1.8, 0.3, 0.3, 0.36, -0.12, 4),
      ],
      { radial: Math.max(8, (s.radial * 0.45) | 0), rings: Math.max(4, (s.rings * 0.2) | 0) },
    );
    intakeR.applyMatrix4(new THREE.Matrix4().makeRotationZ(-0.12).setPosition(1.2 * F.width, 0, 0));
    const intakeL = intakeR.clone().applyMatrix4(new THREE.Matrix4().makeScale(-1, 1, 1));
    flipWinding(intakeL);
    add(intakeR, 'body');
    add(intakeL, 'body');
  }

  const surf = (def, extra = {}) => ({
    rootThickness: 0.05,
    tipThickness: 0.035,
    spanSegments: s.wingSpan,
    chordSegments: s.wingChord,
    ...def,
    ...extra,
  });
  const scaleDef = (d) => ({
    ...d,
    rootLE: [d.rootLE[0] * F.width, d.rootLE[1], d.rootLE[2] * F.length],
    tipLE: [d.tipLE[0], d.tipLE[1], d.tipLE[2] * F.length],
  });

  const wing = scaleDef(design.wing);
  add(liftingSurface(surf(wing)), 'body');
  add(liftingSurface(surf(wing, { mirror: true })), 'body');

  if (design.lerx && lod < 2) {
    const lerx = scaleDef({ rootLE: [0.62, 0.0, -5.4], rootChord: 5.0, tipLE: [1.35 * F.width, 0.02, -1.55], tipChord: 1.6 });
    const d = surf(lerx, { rootThickness: 0.03, tipThickness: 0.04, spanSegments: Math.max(1, (s.wingSpan / 2) | 0) });
    add(liftingSurface(d), 'body');
    add(liftingSurface({ ...d, mirror: true }), 'body');
  }

  if (design.stab) {
    const stab = scaleDef(design.stab);
    const d = surf(stab, { rootThickness: 0.045, spanSegments: Math.max(1, (s.wingSpan * 0.6) | 0) });
    add(liftingSurface(d), 'body');
    add(liftingSurface({ ...d, mirror: true }), 'body');
  }

  if (design.canards) {
    const c = { rootLE: [0.75, 0.05, -5.6 * F.length], rootChord: 1.9, tipLE: [2.9, 0.05, -4.5 * F.length], tipChord: 0.7 };
    const d = surf(c, { rootThickness: 0.03, spanSegments: Math.max(1, (s.wingSpan * 0.4) | 0) });
    add(liftingSurface(d), 'body');
    add(liftingSurface({ ...d, mirror: true }), 'body');
  }

  // Vertical tails (canted twin, V, or a single fin).
  const T = design.tails;
  const ts = T.scale;
  const tailDef = surf(
    { rootLE: [0, 0, 3.4 * F.length], rootChord: 3.9 * ts, tipLE: [3.4 * ts, 0, 3.4 * F.length + 2.65 * ts], tipChord: 1.35 * ts },
    { spanSegments: Math.max(1, (s.wingSpan * 0.7) | 0) },
  );
  const cant = THREE.MathUtils.degToRad(T.cant);
  const tailY = 0.34 * F.height;
  if (T.count === 1) {
    const fin = liftingSurface(tailDef).applyMatrix4(
      new THREE.Matrix4().makeTranslation(0, tailY + 0.2, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)),
    );
    add(fin, 'body');
  } else if (T.count === 2) {
    add(
      liftingSurface(tailDef).applyMatrix4(
        new THREE.Matrix4()
          .makeTranslation(T.x * F.width, tailY, 0)
          .multiply(new THREE.Matrix4().makeRotationZ(-cant))
          .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2)),
      ),
      'body',
    );
    add(
      liftingSurface({ ...tailDef, mirror: true }).applyMatrix4(
        new THREE.Matrix4()
          .makeTranslation(-T.x * F.width, tailY, 0)
          .multiply(new THREE.Matrix4().makeRotationZ(cant))
          .multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2)),
      ),
      'body',
    );
  }

  if (design.ventral && lod < 2) {
    const v = surf(
      { rootLE: [0, 0, 4.8 * F.length], rootChord: 2.0, tipLE: [0.7, 0, 5.9 * F.length], tipChord: 0.9 },
      { spanSegments: 2, chordSegments: Math.max(3, s.wingChord / 2) | 0 },
    );
    add(
      liftingSurface(v).applyMatrix4(
        new THREE.Matrix4().makeTranslation(0.95 * F.width, -0.5, 0).multiply(new THREE.Matrix4().makeRotationZ(-Math.PI / 2 - 0.35)),
      ),
      'trim',
    );
    add(
      liftingSurface({ ...v, mirror: true }).applyMatrix4(
        new THREE.Matrix4().makeTranslation(-0.95 * F.width, -0.5, 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2 + 0.35)),
      ),
      'trim',
    );
  }

  // Canopy.
  const cz = -4.55 * F.length;
  const canopy = new THREE.SphereGeometry(1, lod === 0 ? 40 : lod === 1 ? 14 : 6, lod === 0 ? 20 : 6, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.applyMatrix4(new THREE.Matrix4().makeTranslation(0, 0.36 * F.height, cz).multiply(new THREE.Matrix4().makeScale(0.5, 0.46, 2.15)));
  add(canopy, 'canopy');

  // Nozzles.
  const nozzleX = design.nozzles === 1 ? [0] : [-0.62 * F.width, 0.62 * F.width];
  const nz = tailZ + 0.45;
  for (const x of nozzleX) {
    const outer = new THREE.CylinderGeometry(0.47, 0.6, 1.25, lod === 0 ? 32 : lod === 1 ? 12 : 6, 1, lod < 2);
    outer.rotateX(Math.PI / 2);
    outer.translate(x, -0.02, nz);
    add(outer, 'metal');
    if (lod < 2) {
      const inner = new THREE.CylinderGeometry(0.455, 0.58, 1.2, lod === 0 ? 32 : 12, 1, true);
      inner.rotateX(Math.PI / 2);
      inner.translate(x, -0.02, nz);
      add(inner, 'nozzleInner');
      const turbine = new THREE.CircleGeometry(0.46, lod === 0 ? 32 : 12);
      turbine.translate(x, -0.02, nz - 0.2);
      add(turbine, 'turbine');
    }
    if (lod === 0) {
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        const petal = new THREE.BoxGeometry(0.2, 0.03, 0.6);
        petal.applyMatrix4(
          new THREE.Matrix4()
            .makeTranslation(x + Math.cos(a) * 0.46, -0.02 + Math.sin(a) * 0.46, nz + 0.55)
            .multiply(new THREE.Matrix4().makeRotationZ(a + Math.PI / 2))
            .multiply(new THREE.Matrix4().makeRotationX(-0.12)),
        );
        add(petal, 'metal');
      }
    }
  }

  if (lod < 2) {
    // Intake mouths.
    for (const side of [-1, 1]) {
      const m = new THREE.CylinderGeometry(0.36, 0.36, 0.9, lod === 0 ? 20 : 8, 1, true);
      m.rotateX(Math.PI / 2);
      m.scale(0.9, 0.95, 1);
      m.translate(side * 1.2 * F.width, -0.14, -2.95 * F.length);
      add(m, 'cavity');
    }
  }

  // Stores: pylons + missiles under the wings.
  if (lod === 0) {
    for (const span of design.stores) {
      for (const side of [-1, 1]) {
        const x = side * span;
        const zc = 2.4 + (span - 3.7) * 0.25;
        const body = new THREE.CylinderGeometry(0.085, 0.085, 2.6, 12);
        body.rotateX(Math.PI / 2);
        body.translate(x, -0.38, zc);
        const nose = new THREE.ConeGeometry(0.085, 0.45, 12);
        nose.rotateX(-Math.PI / 2);
        nose.translate(x, -0.38, zc - 1.52);
        const pylon = new THREE.BoxGeometry(0.06, 0.26, 1.4);
        pylon.translate(x, -0.2, zc);
        add(body, 'store');
        add(nose, 'store');
        add(pylon, 'trim');
        for (let i = 0; i < 4; i++) {
          const fin = new THREE.BoxGeometry(0.34, 0.012, 0.3);
          fin.applyMatrix4(new THREE.Matrix4().makeTranslation(x, -0.38, zc + 1.1).multiply(new THREE.Matrix4().makeRotationZ((i * Math.PI) / 2 + Math.PI / 4)));
          add(fin, 'store');
        }
      }
    }
    // Formation light strips.
    for (const side of [-1, 1]) {
      const s1 = new THREE.BoxGeometry(0.02, 0.05, 0.9);
      s1.applyMatrix4(new THREE.Matrix4().makeTranslation(side * 1.02 * F.width, 0.28, -3.2 * F.length).multiply(new THREE.Matrix4().makeRotationY(side * 0.16)));
      add(s1, 'strip');
    }
  }

  // Anchors for effects / cameras / hit boxes.
  const tipX = design.wing.tipLE[0];
  const anchors = {
    nozzles: nozzleX.map((x) => new THREE.Vector3(x, -0.02, nz + 0.6)),
    nozzleRadius: 0.44,
    wingtips: [new THREE.Vector3(-tipX, 0.05, design.wing.tipLE[2] * F.length + 0.6), new THREE.Vector3(tipX, 0.05, design.wing.tipLE[2] * F.length + 0.6)],
    cockpit: new THREE.Vector3(0, 0.78 * F.height, -4.7 * F.length),
    gun: new THREE.Vector3(0.9, 0.25, -5.6 * F.length),
    nose: noseZ,
    tail: tailZ + 1.1,
    span: tipX * 2,
    tailMark: { x: T.x * F.width, y: tailY, cant, z: 3.4 * F.length + 2.45 * ts, count: T.count, scale: ts },
  };
  return { parts, anchors };
}

const PART_COLORS = {
  body: [1, 1, 1],
  trim: [0.55, 0.57, 0.6],
  canopy: [0.25, 0.18, 0.08],
  metal: [0.48, 0.46, 0.45],
  cavity: [0.02, 0.02, 0.02],
  nozzleInner: [0.25, 0.12, 0.06],
  turbine: [0.9, 0.5, 0.25],
  store: [1.4, 1.42, 1.45],
  strip: [1.2, 2.2, 1.3],
};

/**
 * Merged single-geometry airframe with vertex colours, for InstancedMesh.
 * Body parts are white so the per-instance colour paints them.
 */
export function buildJetGeometry(designId, lod) {
  const { parts, anchors } = buildParts(JET_DESIGNS[designId], lod);
  const geos = parts.map(({ geometry, part }) => {
    const g = clean(geometry.index ? geometry.toNonIndexed() : geometry);
    if (g !== geometry) geometry.dispose();
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    const c = PART_COLORS[part];
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return { geometry: merged, anchors };
}

/** Full-detail, multi-material jet for the player, wingmen close-ups and the hangar. */
export function buildJet(designId, { paint = 0x4c535c, callsign = 'RS-01', panelScale = 1.35 } = {}) {
  const design = JET_DESIGNS[designId];
  const { parts, anchors } = buildParts(design, 0);
  const group = new THREE.Group();
  group.name = 'Jet:' + designId;
  const disposables = [];
  const track = (x) => (disposables.push(x), x);

  const skin = track(createSkinMaterial({ color: paint, panelScale }));
  const darkSkin = track(createSkinMaterial({ color: 0x353b43, roughness: 0.45, lineStrength: 0.4 }));
  const titanium = track(
    new THREE.MeshPhysicalMaterial({ color: 0x6f6a66, metalness: 1, roughness: 0.32, envMapIntensity: 1.4, iridescence: 0.35, iridescenceIOR: 1.8 }),
  );
  const canopyMat = track(
    new THREE.MeshPhysicalMaterial({ color: 0x3a2a12, metalness: 1, roughness: 0.22, envMapIntensity: 1.4, clearcoat: 0.6, clearcoatRoughness: 0.12, iridescence: 0.55 }),
  );
  const cavity = track(new THREE.MeshStandardMaterial({ color: 0x050506, roughness: 0.9, metalness: 0.2, side: THREE.DoubleSide }));
  const nozzleInnerMat = track(
    new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.6, metalness: 0.7, side: THREE.BackSide, emissive: 0xff7a2a, emissiveIntensity: 0.4 }),
  );
  const turbineMat = track(new THREE.MeshBasicMaterial({ map: track(turbineTexture()) }));
  const storeMat = track(new THREE.MeshStandardMaterial({ color: 0x9ea3a8, metalness: 0.5, roughness: 0.45 }));
  const stripMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 1.1, 0.6) }));
  const mats = { body: skin, trim: darkSkin, canopy: canopyMat, metal: titanium, cavity, nozzleInner: nozzleInnerMat, turbine: turbineMat, store: storeMat, strip: stripMat };

  // Merge per material to keep the player jet at ~9 draw calls.
  const byPart = {};
  for (const { geometry, part } of parts) (byPart[part] ||= []).push(geometry);
  for (const [part, list] of Object.entries(byPart)) {
    const geos = list.map((g) => clean(g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    list.forEach((g) => g.dispose());
    track(merged);
    const mesh = new THREE.Mesh(merged, mats[part]);
    mesh.name = part;
    mesh.castShadow = part !== 'cavity' && part !== 'turbine' && part !== 'strip';
    mesh.receiveShadow = part === 'body' || part === 'trim';
    group.add(mesh);
  }

  // Tail markings.
  const tm = anchors.tailMark;
  const markTex = track(tailMarkingTexture(callsign));
  const markMat = track(
    new THREE.MeshStandardMaterial({ map: markTex, transparent: true, roughness: 0.5, metalness: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
  );
  const markGeo = track(new THREE.PlaneGeometry(1.7 * tm.scale, 0.85 * tm.scale));
  const sides = tm.count === 1 ? [1, -1] : [-1, 1];
  for (const side of tm.count === 0 ? [] : sides) {
    const c = tm.count === 1 ? 0 : tm.cant;
    const spanDir = new THREE.Vector3(side * Math.sin(c), Math.cos(c), 0);
    const normal = new THREE.Vector3(side * Math.cos(c), -Math.sin(c), 0);
    const xAxis = new THREE.Vector3().crossVectors(spanDir, normal);
    const m = new THREE.Mesh(markGeo, markMat);
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, spanDir, normal));
    const baseX = tm.count === 1 ? 0 : side * tm.x;
    m.position.set(baseX, tm.y + (tm.count === 1 ? 0.2 : 0), 0).addScaledVector(spanDir, 1.3 * tm.scale).addScaledVector(normal, tm.count === 1 ? 0.06 : 0.09);
    m.position.z = tm.z;
    group.add(m);
  }

  return {
    group,
    anchors,
    skin,
    nozzleInnerMat,
    setPaint(color) {
      skin.color.set(color);
    },
    dispose() {
      disposables.forEach((d) => d.dispose?.());
    },
  };
}

/** Instanced-friendly material shared by all merged jets (vertex colours × instance colour). */
export function createJetInstanceMaterial() {
  const m = createSkinMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.55, lineStrength: 0.3 });
  m.vertexColors = true;
  return m;
}
