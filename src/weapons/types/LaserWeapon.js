import * as THREE from 'three';
import { Weapon } from '../Weapon.js';
import { segmentPointDist2 } from '../../core/math.js';

// Sustained laser beam: hitscan every step while held, damage per second,
// drains an energy pool that recharges when idle. Overdrain = lockout.
// Config: dps, range, drain (energy/s), ammo (= energy capacity), regen

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, team: 0, owner: null, best: null, bestT: 2 };

function visit(u, c) {
  if (!u.alive || u.team === c.team || u === c.owner) return;
  const r = u.radius * 0.7 + 1;
  if (segmentPointDist2(c.x, c.y, c.z, c.dx, c.dy, c.dz, u.pos.x, u.pos.y, u.pos.z) > r * r) return;
  const t = ((u.pos.x - c.x) * c.dx + (u.pos.y - c.y) * c.dy + (u.pos.z - c.z) * c.dz) / (c.dx * c.dx + c.dy * c.dy + c.dz * c.dz);
  if (t >= 0 && t < c.bestT) {
    c.bestT = t;
    c.best = u;
  }
}

export class LaserWeapon extends Weapon {
  constructor(def, owner, opts) {
    super(def, owner, opts);
    this.firing = false;
    this.lockout = 0;
    this.beamEnd = new THREE.Vector3();
    this.beamStart = new THREE.Vector3();
  }

  passive(dt, ctx) {
    if (this.lockout > 0) this.lockout -= dt;
    if (!this.firing) super.passive(dt, ctx);
  }

  onDeselect() {
    if (this.firing && this.owner.isPlayer) this._ctx?.audio?.laser(false);
    this.firing = false;
  }

  reset() {
    super.reset();
    this.firing = false;
    this.lockout = 0;
  }

  update(dt, ctx, trig) {
    const d = this.def;
    const o = this.owner;
    this._ctx = ctx;
    this.firing = trig.held && this.lockout <= 0 && this.ammo > 0;
    if (!this.firing) {
      if (o.isPlayer) ctx.audio?.laser(false);
      this.status = this.lockout > 0 ? 'COOLING' : '';
      return;
    }
    this.ammo -= d.drain * dt;
    if (this.ammo <= 0) {
      this.ammo = 0;
      this.lockout = d.lockout;
    }
    _p.set(0, -0.6, -8).applyQuaternion(o.quat).add(o.pos);
    _d.copy(o.gunDir);
    let len = d.range;
    for (let t = 40; t < d.range; t += 40) {
      _e.copy(_p).addScaledVector(_d, t);
      if (_e.y < ctx.world.surfaceAt(_e.x, _e.z)) {
        len = t;
        break;
      }
    }
    _q.x = _p.x;
    _q.y = _p.y;
    _q.z = _p.z;
    _q.dx = _d.x * len;
    _q.dy = _d.y * len;
    _q.dz = _d.z * len;
    _q.team = o.team;
    _q.owner = o;
    _q.best = null;
    _q.bestT = 2;
    for (let t = 0; t < len; t += 400) {
      const m = Math.min(len, t + 400);
      const c = (t + m) / 2;
      ctx.hash.query(_p.x + _d.x * c, _p.y + _d.y * c, _p.z + _d.z * c, (m - t) / 2 + 60, visit, _q);
    }
    if (_q.best) {
      len *= _q.bestT;
      const u = _q.best;
      ctx.combat.hit(u, this.damage * dt, o, u.pos.x, u.pos.y, u.pos.z, d);
      if (Math.random() < 0.5) ctx.fx.hitSparks(u.pos.x, u.pos.y, u.pos.z, 1.5);
    } else if (len < d.range) {
      _e.copy(_p).addScaledVector(_d, len);
      if (Math.random() < 0.4) ctx.fx.impactGround(_e.x, _e.y, _e.z, 2);
    }
    _q.owner = _q.best = null;
    this.beamStart.copy(_p);
    this.beamEnd.copy(_p).addScaledVector(_d, len);
    ctx.fx.timedBeam(_p.x, _p.y, _p.z, this.beamEnd.x, this.beamEnd.y, this.beamEnd.z, 0.5, 0.05, 5, 0.6, 0.5);
    if (o.isPlayer) ctx.audio?.laser(true);
    this.status = 'FIRING';
  }

  hud() {
    const h = super.hud();
    h.ammo = Math.floor((this.ammo / this.maxAmmo) * 100) + '%';
    h.bar = { value: this.ammo / this.maxAmmo, label: 'ENERGY', warn: this.lockout > 0 };
    return h;
  }
}
