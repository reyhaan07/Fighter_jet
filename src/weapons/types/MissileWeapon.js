import * as THREE from 'three';
import { Weapon } from '../Weapon.js';

// Guided missiles with a lock-on seeker: heat-seekers (lock tone, decoyed by
// flares), radar missiles (fire-and-forget, multi-target lock), swarm volleys
// and anti-ship missiles. AI pilots and the player share this class.
//
// Config: seeker ('ir' | 'radar' | 'ship' | 'ground'), lockTime, range, cone (deg),
//         maxLocks, salvo (missiles per target), volley (missiles per press),
//         ordnance params (speed, accel, burn, turnRate, damage, splash, ...).

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _rail = new THREE.Vector3();

export class MissileWeapon extends Weapon {
  constructor(def, owner, opts) {
    super(def, owner, opts);
    this.locks = [];
    this.lockProgress = 0;
    this.candidate = null;
    this.cosCone = Math.cos(((def.cone ?? 20) * Math.PI) / 180);
    this.side = 1;
    this.volleyLeft = 0;
    this.volleyTimer = 0;
    this.lockState = 'off';
  }

  reset() {
    super.reset();
    this.locks.length = 0;
    this.lockProgress = 0;
    this.candidate = null;
    this.volleyLeft = 0;
    this.lockState = 'off';
  }

  onDeselect() {
    this.locks.length = 0;
    this.lockProgress = 0;
    this.candidate = null;
    this.lockState = 'off';
  }

  /** Can the seeker see this unit? */
  valid(u) {
    const d = this.def;
    if (!u || !u.alive || u.team === this.owner.team || u.invulnerable || !u.isTarget) return false;
    if (d.seeker === 'ir' || d.seeker === 'radar') {
      if (!u.isAir) return false;
    } else if (d.seeker === 'ship') {
      if (u.kind !== 'sea') return false;
    } else if (d.seeker === 'ground') {
      if (u.isAir && u.kind !== 'part') return false;
    }
    _d.copy(u.pos).sub(this.owner.pos);
    const dist = _d.length();
    const range = d.range * (d.seeker === 'radar' ? Math.max(0.4, u.signature) * (u.ecm > 0 ? 0.6 : 1) : 1);
    if (dist > range || dist < (d.minRange ?? 150)) return false;
    _v.set(0, 0, -1).applyQuaternion(this.owner.quat);
    return _v.dot(_d) / dist >= this.cosCone;
  }

  /** Best new lock candidate: the player's selected target first, then nearest to the nose. */
  pick(ctx) {
    const o = this.owner;
    if (o.target && this.valid(o.target) && !this.locks.includes(o.target)) return o.target;
    if (!o.isPlayer && !o.isWingman) return null;
    let best = null;
    let bestScore = -Infinity;
    const units = ctx.entities.units;
    _v.set(0, 0, -1).applyQuaternion(o.quat);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (this.locks.includes(u) || !this.valid(u)) continue;
      _d.copy(u.pos).sub(o.pos);
      const dist = _d.length();
      const score = _v.dot(_d) / dist - dist / 30000;
      if (score > bestScore) {
        bestScore = score;
        best = u;
      }
    }
    return best;
  }

  update(dt, ctx, trig) {
    const d = this.def;
    const o = this.owner;
    // Drop locks that left the seeker.
    for (let i = this.locks.length - 1; i >= 0; i--) if (!this.valid(this.locks[i])) this.locks.splice(i, 1);

    // Acquire.
    const maxLocks = d.maxLocks ?? 1;
    if (this.locks.length < maxLocks && this.ammo >= 1) {
      const c = this.pick(ctx);
      if (c !== this.candidate) {
        this.candidate = c;
        this.lockProgress = 0;
      }
      if (c) {
        const sig = d.seeker === 'ir' ? Math.max(0.5, c.heat ?? 0.6) : Math.max(0.35, c.signature);
        const mult = o.team === 1 ? ctx.difficulty.lockTimeMult : 1;
        this.lockProgress += (dt * sig) / Math.max(0.05, this.lockTime * mult);
        if (c.isPlayer && o.team === 1) ctx.warnings.locking(o, this.lockProgress);
        if (this.lockProgress >= 1) {
          this.locks.push(c);
          this.candidate = null;
          this.lockProgress = 0;
          if (o.isPlayer) ctx.audio?.lockAcquired();
        }
      } else this.lockProgress = Math.max(0, this.lockProgress - dt * 2);
    }
    for (let i = 0; i < this.locks.length; i++) if (this.locks[i].isPlayer && o.team === 1) ctx.warnings.locking(o, 1);

    this.lockState = this.locks.length ? 'locked' : this.candidate ? 'locking' : 'search';
    if (o.isPlayer) ctx.audio?.lockTone(d.seeker === 'ir' ? this.lockState : this.lockState === 'locking' ? 'radar' : this.lockState === 'locked' ? 'locked' : 'search');
    this.status = this.cooldown > 0 ? 'RELOAD' : this.lockState === 'locked' ? (maxLocks > 1 ? `LOCK ${this.locks.length}` : 'LOCK') : this.lockState === 'locking' ? 'LOCKING' : '';

    // Volley in progress (swarm / multi-launch).
    if (this.volleyLeft > 0) {
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0) {
        this.volleyTimer = d.volleyInterval ?? 0.06;
        this._fireOne(ctx, this.volleyTargets[this.volleyIndex++ % Math.max(1, this.volleyTargets.length)] || null);
        this.volleyLeft--;
      }
      return;
    }

    const wantFire = o.isPlayer ? trig.pressed : trig.held && this.locks.length > 0;
    if (wantFire && this.cooldown <= 0 && (this.ammo >= 1 || this.infinite)) {
      const targets = (this.volleyTargets ||= []);
      targets.length = 0;
      for (const l of this.locks) targets.push(l);
      if (!targets.length && o.isPlayer && d.fireWithoutLock === false) {
        ctx.audio?.denied();
        return;
      }
      const volley = d.volley ?? Math.max(1, targets.length * (d.salvo ?? 1));
      this.volleyLeft = Math.min(volley, this.infinite ? volley : Math.floor(this.ammo / (d.ammoPerMissile ?? 1)) || 1);
      this.volleyIndex = 0;
      this.volleyTimer = 0;
      this.cooldown = this.reloadTime;
      this.locks.length = 0;
      this.lockProgress = 0;
      this.update(0, ctx, trig);
    }
  }

  _fireOne(ctx, target) {
    const d = this.def;
    const o = this.owner;
    if (!this.useAmmo(d.ammoPerMissile ?? 1)) {
      this.volleyLeft = 0;
      return;
    }
    this.side = -this.side;
    const rail = d.rails ? d.rails[(this.volleyIndex ?? 0) % d.rails.length] : [3.4, -0.5, 2.0];
    _rail.set(rail[0] * this.side, rail[1], rail[2]);
    this.muzzle(_v, _rail);
    _d.set(0, 0, -1).applyQuaternion(o.quat);
    if (d.spreadLaunch) {
      _d.x += (Math.random() - 0.5) * d.spreadLaunch;
      _d.y += (Math.random() - 0.5) * d.spreadLaunch;
      _d.z += (Math.random() - 0.5) * d.spreadLaunch;
      _d.normalize();
    }
    const m = ctx.ordnance.launch(d, o, target, _v, _d, Math.max(80, o.vel.length() * 0.95), { damage: this.damage });
    if (o.isPlayer) {
      ctx.audio?.missileLaunch(d.sound || 'missile');
      ctx.events.emit('playerFired', this, target);
    } else ctx.audio?.missileLaunch('missile', _v);
    if (target?.isPlayer) ctx.warnings.launch(m);
  }

  hud() {
    const h = super.hud();
    if (this.lockState === 'locking') h.bar = { value: this.lockProgress, label: 'LOCK', warn: false };
    return h;
  }
}
