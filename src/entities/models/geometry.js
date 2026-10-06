import * as THREE from 'three';

// Geometry builders for the procedural aircraft.

function hermite(stations, key, z) {
  const n = stations.length;
  let i = 0;
  while (i < n - 2 && z > stations[i + 1].z) i++;
  const a = stations[i];
  const b = stations[i + 1];
  const dz = b.z - a.z;
  const t = THREE.MathUtils.clamp((z - a.z) / dz, 0, 1);
  const slope = (k) => {
    const p = stations[Math.max(0, k - 1)];
    const q = stations[Math.min(n - 1, k + 1)];
    return (q[key] - p[key]) / (q.z - p.z);
  };
  const m0 = slope(i) * dz;
  const m1 = slope(i + 1) * dz;
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * a[key] +
    (t3 - 2 * t2 + t) * m0 +
    (-2 * t3 + 3 * t2) * b[key] +
    (t3 - t2) * m1
  );
}

const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

/**
 * Sweeps a superellipse cross-section along Z.
 * station: { z, w (half width), ht (half height above), hb (below), y (center), n (exponent) }
 */
export function loft(stations, { radial = 48, rings = 90, capEnd = false, capStart = false } = {}) {
  const positions = [];
  const indices = [];
  const z0 = stations[0].z;
  const z1 = stations[stations.length - 1].z;

  for (let r = 0; r < rings; r++) {
    // Denser sampling near the nose where curvature is highest.
    const u = r / (rings - 1);
    const z = z0 + (z1 - z0) * (u < 0.5 ? 0.5 * Math.pow(u * 2, 1.35) : u);
    const w = Math.max(0.004, hermite(stations, 'w', z));
    const ht = Math.max(0.004, hermite(stations, 'ht', z));
    const hb = Math.max(0.004, hermite(stations, 'hb', z));
    const y = hermite(stations, 'y', z);
    const ne = hermite(stations, 'n', z);
    const e = 2 / ne;
    for (let k = 0; k < radial; k++) {
      const th = (k / radial) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      positions.push(w * spow(c, e), y + (s >= 0 ? ht : hb) * spow(s, e), z);
    }
  }
  for (let r = 0; r < rings - 1; r++) {
    for (let k = 0; k < radial; k++) {
      const a = r * radial + k;
      const b = r * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      indices.push(a, b, c, b, d, c);
    }
  }
  const addCap = (ring, flip) => {
    let cx = 0;
    let cy = 0;
    const base = ring * radial;
    for (let k = 0; k < radial; k++) {
      cx += positions[(base + k) * 3];
      cy += positions[(base + k) * 3 + 1];
    }
    const center = positions.length / 3;
    positions.push(cx / radial, cy / radial, positions[base * 3 + 2]);
    for (let k = 0; k < radial; k++) {
      const a = base + k;
      const b = base + ((k + 1) % radial);
      if (flip) indices.push(center, b, a);
      else indices.push(center, a, b);
    }
  };
  if (capEnd) addCap(rings - 1, false);
  if (capStart) addCap(0, true);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

// Closed-trailing-edge NACA 4-digit thickness distribution (half thickness / chord).
const naca = (x, t) =>
  5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

/**
 * A wing-like surface. Built in "wing space": span runs along the root→tip leading
 * edge, chord along +Z, thickness along +Y.
 */
export function liftingSurface({
  rootLE,
  rootChord,
  tipLE,
  tipChord,
  rootThickness = 0.06,
  tipThickness = 0.04,
  spanSegments = 14,
  chordSegments = 22,
  mirror = false,
}) {
  const positions = [];
  const indices = [];
  const cols = chordSegments + 1;
  const rows = spanSegments + 1;
  const le = new THREE.Vector3();

  for (const side of [1, -1]) {
    for (let i = 0; i < rows; i++) {
      const s = i / spanSegments;
      le.set(
        THREE.MathUtils.lerp(rootLE[0], tipLE[0], s),
        THREE.MathUtils.lerp(rootLE[1], tipLE[1], s),
        THREE.MathUtils.lerp(rootLE[2], tipLE[2], s),
      );
      const chord = THREE.MathUtils.lerp(rootChord, tipChord, s);
      const th = THREE.MathUtils.lerp(rootThickness, tipThickness, s);
      for (let j = 0; j < cols; j++) {
        const c = 0.5 - 0.5 * Math.cos((j / chordSegments) * Math.PI); // cosine spacing
        const yt = naca(c, th) * chord * side;
        positions.push(le.x, le.y + yt, le.z + c * chord);
      }
    }
  }

  const top = 0;
  const bottom = rows * cols;
  for (let i = 0; i < spanSegments; i++) {
    for (let j = 0; j < chordSegments; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(top + a, top + b, top + c, top + c, top + b, top + d);
      indices.push(bottom + a, bottom + c, bottom + b, bottom + c, bottom + d, bottom + b);
    }
  }
  // Tip and root caps.
  for (const [row, flip] of [
    [spanSegments, false],
    [0, true],
  ]) {
    for (let j = 0; j < chordSegments; j++) {
      const t0 = top + row * cols + j;
      const t1 = t0 + 1;
      const b0 = bottom + row * cols + j;
      const b1 = b0 + 1;
      if (flip) indices.push(t0, t1, b0, b0, t1, b1);
      else indices.push(t0, b0, t1, b0, b1, t1);
    }
  }

  if (mirror) {
    for (let k = 0; k < positions.length; k += 3) positions[k] = -positions[k];
    for (let k = 0; k < indices.length; k += 3) {
      const tmp = indices[k + 1];
      indices[k + 1] = indices[k + 2];
      indices[k + 2] = tmp;
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/** Strips everything but position/normal so geometries can be merged. */
export function clean(geometry) {
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== 'position' && name !== 'normal') geometry.deleteAttribute(name);
  }
  return geometry;
}
