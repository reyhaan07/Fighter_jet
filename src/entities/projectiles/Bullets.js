import { segmentPointDist2, segmentSegmentDist2 } from '../../core/math.js';

// Pooled ballistic projectiles (cannon rounds, plasma bolts, flak) stored as
// structure-of-arrays. Each simulation step a bullet sweeps the segment it
// travelled against the spatial hash (a raycast per step), so fast rounds
// never tunnel through targets. Rendered as one instanced tracer batch.

export const BULLET_STYLES = [
  // r, g, b, width, length(m), glow
  [4.0, 3.0, 1.2, 0.35, 26, 0], // 0: 20mm tracer
  [4.5, 2.2, 0.6, 0.6, 30, 0], // 1: 30mm
  [1.2, 2.4, 6.0, 2.2, 14, 6], // 2: plasma
  [5.0, 1.0, 0.6, 0.45, 26, 0], // 3: enemy cannon (red)
  [4.0, 1.8, 0.8, 0.6, 22, 0], // 4: AA tracer
  [2.4, 4.5, 2.0, 0.4, 20, 0], // 5: wingman (green)
];

// Query context reused for every bullet (no closures allocated per step).
const _q = { u: null, best: 2, team: 0, owner: null, fuse: 0, x0: 0, y0: 0, z0: 0, dx: 0, dy: 0, dz: 0 };

function visit(u, c) {
  if (!u.alive || u.team === c.team || u === c.owner || u.parent === c.owner) return;
  const { x0, y0, z0, dx, dy, dz, fuse } = c;
  const r = u.radius + fuse;
  const d2 = segmentPointDist2(x0, y0, z0, dx, dy, dz, u.pos.x, u.pos.y, u.pos.z);
  if (d2 > r * r) return;
  if (u.capsuleHalf > 0 && fuse === 0) {
    // Narrow phase: capsule along the fuselage. forward = q * (0,0,-1)
    const f = u.capsuleHalf;
    const q = u.quat;
    const fx = -2 * (q.x * q.z + q.w * q.y);
    const fy = -2 * (q.y * q.z - q.w * q.x);
    const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    const cr = u.capsuleRadius;
    const s2 = segmentSegmentDist2(x0, y0, z0, dx, dy, dz, u.pos.x - fx * f, u.pos.y - fy * f, u.pos.z - fz * f, fx * 2 * f, fy * 2 * f, fz * 2 * f);
    if (s2 > cr * cr) return;
  }
  // Keep the closest hit along the ray.
  const t = ((u.pos.x - x0) * dx + (u.pos.y - y0) * dy + (u.pos.z - z0) * dz) / Math.max(1e-6, dx * dx + dy * dy + dz * dz);
  if (t < c.best) {
    c.best = t;
    c.u = u;
  }
}

export class Bullets {
  constructor(capacity = 4096) {
    this.capacity = capacity;
    this.px = new Float32Array(capacity);
    this.py = new Float32Array(capacity);
    this.pz = new Float32Array(capacity);
    this.ox = new Float32Array(capacity); // previous position (interpolation)
    this.oy = new Float32Array(capacity);
    this.oz = new Float32Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.age = new Float32Array(capacity);
    this.dmg = new Float32Array(capacity);
    this.splash = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.team = new Int8Array(capacity);
    this.style = new Uint8Array(capacity);
    this.pierce = new Uint8Array(capacity);
    this.fuse = new Float32Array(capacity); // flak proximity fuse radius
    this.owner = new Array(capacity).fill(null);
    this.weapon = new Array(capacity).fill(null);
    this.active = new Int32Array(capacity);
    this.count = 0;
    this.free = new Int32Array(capacity);
    for (let i = 0; i < capacity; i++) this.free[i] = capacity - 1 - i;
    this.freeCount = capacity;
  }

  spawn(x, y, z, vx, vy, vz, life, dmg, team, owner, style, splash = 0, weapon = null, grav = 4, fuse = 0) {
    if (this.freeCount === 0) return -1;
    const i = this.free[--this.freeCount];
    this.px[i] = this.ox[i] = x;
    this.py[i] = this.oy[i] = y;
    this.pz[i] = this.oz[i] = z;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.vz[i] = vz;
    this.life[i] = life;
    this.age[i] = 0;
    this.dmg[i] = dmg;
    this.team[i] = team;
    this.owner[i] = owner;
    this.style[i] = style;
    this.splash[i] = splash;
    this.weapon[i] = weapon;
    this.grav[i] = grav;
    this.fuse[i] = fuse;
    this.pierce[i] = 0;
    this.active[this.count++] = i;
    return i;
  }

  _kill(k) {
    const i = this.active[k];
    this.owner[i] = null;
    this.weapon[i] = null;
    this.active[k] = this.active[--this.count];
    this.free[this.freeCount++] = i;
  }

  clear() {
    while (this.count) this._kill(this.count - 1);
  }

  step(dt, ctx) {
    const { hash, world, combat, fx } = ctx;
    let k = 0;
    while (k < this.count) {
      const i = this.active[k];
      const x0 = (this.ox[i] = this.px[i]);
      const y0 = (this.oy[i] = this.py[i]);
      const z0 = (this.oz[i] = this.pz[i]);
      this.vy[i] -= this.grav[i] * dt;
      const dx = this.vx[i] * dt;
      const dy = this.vy[i] * dt;
      const dz = this.vz[i] * dt;
      const x1 = (this.px[i] = x0 + dx);
      const y1 = (this.py[i] = y0 + dy);
      const z1 = (this.pz[i] = z0 + dz);
      this.life[i] -= dt;
      this.age[i] += dt;

      // Raycast this step's segment against nearby units.
      _q.u = null;
      _q.best = 2;
      const team = (_q.team = this.team[i]);
      const owner = (_q.owner = this.owner[i]);
      const fuse = (_q.fuse = this.fuse[i]);
      _q.x0 = x0;
      _q.y0 = y0;
      _q.z0 = z0;
      _q.dx = dx;
      _q.dy = dy;
      _q.dz = dz;
      const half = Math.sqrt(dx * dx + dy * dy + dz * dz) * 0.5;
      hash.query(x0 + dx * 0.5, y0 + dy * 0.5, z0 + dz * 0.5, half + 40 + fuse, visit, _q);
      _q.owner = null;

      let dead = false;
      if (_q.u) {
        const u = _q.u;
        const t = Math.max(0, Math.min(1, _q.best));
        const hx = x0 + dx * t;
        const hy = y0 + dy * t;
        const hz = z0 + dz * t;
        if (fuse > 0) {
          fx.flak(hx, hy, hz);
          combat.splash(hx, hy, hz, fuse * 1.6, this.dmg[i], owner, team, this.weapon[i]);
        } else {
          combat.hit(u, this.dmg[i], owner, hx, hy, hz, this.weapon[i]);
          if (this.splash[i] > 0) {
            combat.splash(hx, hy, hz, this.splash[i], this.dmg[i] * 0.4, owner, team, this.weapon[i], u);
            fx.explosion(hx, hy, hz, this.splash[i] * 0.8, { debris: false });
          } else fx.hitSparks(hx, hy, hz, this.style[i] === 1 ? 1.6 : 1);
        }
        dead = true;
      } else {
        const ground = world.heightAt(x1, z1);
        const surface = ground > 0 ? ground : 0;
        if (y1 <= surface) {
          const water = ground <= 0;
          if (this.splash[i] > 0) {
            fx.explosion(x1, surface + 1, z1, this.splash[i] * 0.7, { water, debris: false });
            combat.splash(x1, surface, z1, this.splash[i], this.dmg[i] * 0.5, owner, team, this.weapon[i]);
          } else fx.impactGround(x1, surface, z1, this.style[i] === 1 ? 1.5 : 0.8, water);
          dead = true;
        } else if (this.life[i] <= 0) {
          if (fuse > 0) fx.flak(x1, y1, z1);
          dead = true;
        }
      }
      if (dead) this._kill(k);
      else k++;
    }
  }

  /** Writes interpolated tracers into the beam batch. */
  render(alpha, beams, glows) {
    for (let k = 0; k < this.count; k++) {
      const i = this.active[k];
      const x = this.ox[i] + (this.px[i] - this.ox[i]) * alpha;
      const y = this.oy[i] + (this.py[i] - this.oy[i]) * alpha;
      const z = this.oz[i] + (this.pz[i] - this.oz[i]) * alpha;
      const s = BULLET_STYLES[this.style[i]];
      const vx = this.vx[i];
      const vy = this.vy[i];
      const vz = this.vz[i];
      const sp = Math.max(1, Math.sqrt(vx * vx + vy * vy + vz * vz));
      // Tracer tail never extends back past the muzzle.
      const inv = Math.min(s[4], sp * (this.age[i] + alpha / 60) * 0.9) / sp;
      beams.add(x - vx * inv, y - vy * inv, z - vz * inv, x, y, z, s[3], 0.0016, s[0], s[1], s[2], 1);
      if (s[5]) glows.add(x, y, z, s[5], s[0] * 0.6, s[1] * 0.6, s[2] * 0.6, 1);
    }
  }
}

