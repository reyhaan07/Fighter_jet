import * as THREE from 'three';
import { Weapon } from '../Weapon.js';
import { segmentPointDist2 } from '../../core/math.js';

// Railgun: hold the gun trigger to charge, release to fire. Hitscan raycast
// against the spatial hash that pierces through every unit on the line.
// Damage scales with charge. Config: chargeTime, minCharge, range, damage, pierce

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _hits = [];
const _q = { x: 0, y: 0, z: 0, dx: 0, dy: 0, dz: 0, team: 0, owner: null, list: _hits };

function visit(u, c) {
  if (!u.alive || u.team === c.team || u === c.owner) return;
  const r = u.radius * 0.8 + 1.5;
  if (segmentPointDist2(c.x, c.y, c.z, c.dx, c.dy, c.dz, u.pos.x, u.pos.y, u.pos.z) <= r * r) c.list.push(u);
}

export class RailgunWeapon extends Weapon {
  constructor(def, owner, opts) {
    super(def, owner, opts);
    this.charge = 0;
  }

  reset() {
    super.reset();
    this.charge = 0;
  }

  update(dt, ctx, trig) {
    const d = this.def;
    if (trig.held && this.cooldown <= 0 && this.ammo >= 1) {
      this.charge = Math.min(1, this.charge + dt / d.chargeTime);
      if (this.owner.isPlayer) ctx.audio?.railCharge(this.charge);
    }
    if (trig.released && this.charge > 0) {
      if (this.charge >= d.minCharge && this.useAmmo(1)) this.fire(ctx, this.charge);
      else ctx.audio?.railCharge(0);
      this.charge = 0;
    }
    this.status = this.cooldown > 0 ? 'RECHARGE' : this.charge >= 1 ? 'FULL' : this.charge > 0 ? 'CHARGING' : '';
  }

  fire(ctx, charge) {
    const d = this.def;
    const o = this.owner;
    this.cooldown = this.reloadTime;
    _p.set(0, -0.3, -9).applyQuaternion(o.quat).add(o.pos);
    _d.copy(o.gunDir);
    const range = d.range;
    // Stop the beam at the terrain.
    let len = range;
    for (let t = 50; t < range; t += 50) {
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
    _hits.length = 0;
    // Query along the ray in hash-cell sized chunks.
    for (let t = 0; t < len; t += 400) {
      const m = Math.min(len, t + 400);
      const c = (t + m) / 2;
      ctx.hash.query(_p.x + _d.x * c, _p.y + _d.y * c, _p.z + _d.z * c, (m - t) / 2 + 60, visit, _q);
    }
    // Sort hits along the ray and pierce up to N targets.
    _hits.sort((a, b) => a.pos.distanceToSquared(_p) - b.pos.distanceToSquared(_p));
    const dmg = this.damage * (0.35 + 0.65 * charge);
    let n = 0;
    const seen = new Set();
    for (const u of _hits) {
      if (seen.has(u)) continue;
      seen.add(u);
      ctx.combat.hit(u, dmg * Math.pow(0.85, n), o, u.pos.x, u.pos.y, u.pos.z, d);
      ctx.fx.hitSparks(u.pos.x, u.pos.y, u.pos.z, 3);
      if (++n >= d.pierce) break;
    }
    _hits.length = 0;
    _q.owner = null;
    _e.copy(_p).addScaledVector(_d, len);
    ctx.fx.timedBeam(_p.x, _p.y, _p.z, _e.x, _e.y, _e.z, 0.6 + charge * 1.2, 0.9, 1.2, 2.2, 5);
    if (len < range) ctx.fx.explosion(_e.x, _e.y, _e.z, 6 + charge * 6, { debris: false });
    ctx.fx.muzzle(_p.x, _p.y, _p.z, 4, 1.4, 2.4, 6);
    if (o.isPlayer) {
      ctx.shake(0.25 + charge * 0.3);
      ctx.audio?.railFire(charge);
    }
  }

  hud() {
    const h = super.hud();
    h.bar = { value: this.cooldown > 0 ? 1 - this.cooldown / this.reloadTime : this.charge, label: 'CHARGE', warn: false };
    return h;
  }
}
