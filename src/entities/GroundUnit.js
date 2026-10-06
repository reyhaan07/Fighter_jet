import * as THREE from 'three';
import { Unit } from './Unit.js';
import { interceptTime } from '../core/math.js';

// Ground vehicles, static targets, air defences and ships. Units can follow
// a looping path, and can be attached to a parent (ship AA mounts, bomber
// gunners, boss turrets) via a local offset.

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class GroundUnit extends Unit {
  constructor() {
    super();
    this.localOffset = new THREE.Vector3();
    this.path = [];
    this.pathIndex = 0;
    this.yaw = 0;
    this.reload = 0;
    this.lockTimer = 0;
    this.tracking = null;
    this.burst = 0;
    this.burstCooldown = 0;
    this.launchTimer = 0;
    this.aimJitter = 0;
  }

  spawnGround(def, team, x, y, z, yaw) {
    this.baseSpawn(def, team, x, y, z);
    this.kind = def.kind;
    this.isAir = false;
    this.yaw = yaw;
    this.quat.setFromAxisAngle(AXIS_Y, yaw);
    this.prevQuat.copy(this.quat);
    this.path.length = 0;
    this.pathIndex = 0;
    this.reload = Math.random() * (def.reload || 3);
    this.lockTimer = 0;
    this.tracking = null;
    this.burst = 0;
    this.burstCooldown = Math.random() * 2;
    this.launchTimer = def.launchEvery || 0;
    this.localOffset.set(0, 0, 0);
    this.flying = false;
    this.invulnerable = !!def.invulnerable;
    this.heat = def.kind === 'sea' ? 0.7 : 0.45;
    this.paint.set(def.paint ?? 0xffffff);
    this.hidden = !def.model;
    this.renderScale = 1;
    return this;
  }

  setPath(points) {
    this.path.length = 0;
    for (const p of points) this.path.push(p);
    this.pathIndex = 0;
  }

  update(dt, ctx) {
    const def = this.def;
    if (this.parent) {
      const p = this.parent;
      if (!p.active) {
        ctx.combat.kill(this, null, 'parent');
        return;
      }
      this.pos.copy(this.localOffset).applyQuaternion(p.quat).add(p.pos);
      this.quat.copy(p.quat);
      this.vel.copy(p.vel);
    } else if (this.path.length && def.speed && this.disabled <= 0) {
      const wp = this.path[this.pathIndex];
      _d.set(wp.x - this.pos.x, 0, wp.z - this.pos.z);
      const dist = _d.length();
      if (dist < Math.max(30, this.radius)) this.pathIndex = (this.pathIndex + 1) % this.path.length;
      else {
        const want = Math.atan2(-_d.x, -_d.z);
        let dy = want - this.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2;
        while (dy < -Math.PI) dy += Math.PI * 2;
        this.yaw += Math.max(-0.4 * dt, Math.min(0.4 * dt, dy));
        this.quat.setFromAxisAngle(AXIS_Y, this.yaw);
        _v.set(0, 0, -1).applyQuaternion(this.quat).multiplyScalar(def.speed);
        this.vel.copy(_v);
        this.pos.addScaledVector(_v, dt);
        if (!this.flying) this.pos.y = this.kind === 'sea' ? 0 : ctx.world.surfaceAt(this.pos.x, this.pos.z);
      }
    }
    if (this.kind === 'sea') {
      this.wakeTimer = (this.wakeTimer || 0) - dt;
      if (this.wakeTimer <= 0 && this.vel.lengthSq() > 4) {
        this.wakeTimer = 0.1;
        _v.set(0, 0, this.radius * 0.6).applyQuaternion(this.quat).add(this.pos);
        ctx.fx.wake(_v.x, _v.z, this.vel.x, this.vel.z, Math.min(30, this.radius * 0.35));
        _v.set(0, 0, -this.radius * 0.7).applyQuaternion(this.quat).add(this.pos);
        ctx.fx.wake(_v.x, _v.z, this.vel.x * 0.3, this.vel.z * 0.3, Math.min(20, this.radius * 0.2));
      }
      this.pos.y = Math.sin(ctx.time * 0.5 + this.id) * 0.4;
      _q.setFromAxisAngle(_v.set(0, 0, 1), Math.sin(ctx.time * 0.4 + this.id) * 0.015);
      this.quat.setFromAxisAngle(AXIS_Y, this.yaw).multiply(_q);
    }

    if (this.disabled > 0) {
      this.disabled -= dt;
      return;
    }
    const role = def.role;
    if (role === 'sam' || ((role === 'ship' || role === 'carrier') && def.missile)) this._sam(dt, ctx);
    if (role === 'aa') this._aa(dt, ctx);
    if (role === 'carrier' && def.launches) this._launch(dt, ctx);
    if (this.hp < this.maxHp * 0.5 && Math.random() < dt * 6) ctx.fx.groundFire(this.pos.x, this.pos.y + this.radius * 0.4, this.pos.z, Math.min(10, this.radius * 0.4));
  }

  /** Air search: nearest hostile aircraft in range (stealth shrinks range). */
  _findAir(ctx, range) {
    let best = null;
    let bestD = Infinity;
    const air = ctx.entities.air;
    for (let i = 0; i < air.length; i++) {
      const a = air[i];
      if (!a.alive || a.team === this.team) continue;
      const r = range * Math.max(0.35, a.signature) * (a.ecm > 0 ? 0.5 : 1);
      const d = a.pos.distanceToSquared(this.pos);
      if (d < r * r && d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  _sam(dt, ctx) {
    const def = this.def;
    this.reload -= dt;
    const t = this._findAir(ctx, def.range);
    if (t !== this.tracking) {
      this.tracking = t;
      this.lockTimer = 0;
    }
    if (!t) return;
    this.lockTimer += dt;
    const need = 2.5 * ctx.difficulty.lockTimeMult / Math.max(0.35, t.signature);
    if (t.isPlayer) ctx.warnings.samTrack(this, this.lockTimer / need);
    if (this.lockTimer >= need && this.reload <= 0) {
      _v.copy(this.pos);
      _v.y += this.radius * 0.6 + 4;
      _d.copy(t.pos).sub(_v).normalize();
      _d.y = Math.max(_d.y, 0.5);
      _d.normalize();
      ctx.ordnance.launch(def.missile, this, t, _v, _d, 40);
      this.reload = def.reload * (1.4 - ctx.difficulty.skill * 0.5);
      this.lockTimer = need * 0.5;
    }
  }

  _aa(dt, ctx) {
    const def = this.def;
    this.burstCooldown -= dt;
    const t = this._findAir(ctx, def.range);
    if (!t) return;
    if (this.burst <= 0 && this.burstCooldown <= 0) {
      this.burst = 1.2 + Math.random();
      this.burstCooldown = this.burst + 1.5 + Math.random() * 2;
    }
    if (this.burst <= 0) return;
    this.burst -= dt;
    this.reload -= dt;
    if (this.reload > 0) return;
    this.reload = 0.09;
    const speed = 900;
    _v.copy(this.pos);
    if (!this.parent) _v.y += 3;
    const tt = interceptTime(_v.x, _v.y, _v.z, t.pos.x, t.pos.y, t.pos.z, t.vel.x, t.vel.y, t.vel.z, speed);
    if (tt < 0) return;
    const err = (1.1 - ctx.difficulty.skill) * 0.03 * (t.isPlayer ? 1 : 0.5);
    _d.set(t.pos.x + t.vel.x * tt, t.pos.y + t.vel.y * tt, t.pos.z + t.vel.z * tt).sub(_v).normalize();
    _d.x += (Math.random() - 0.5) * err;
    _d.y += (Math.random() - 0.5) * err;
    _d.z += (Math.random() - 0.5) * err;
    _d.normalize();
    const flak = !def.tracerOnly && Math.random() < 0.35;
    ctx.bullets.spawn(_v.x, _v.y, _v.z, _d.x * speed, _d.y * speed, _d.z * speed, Math.min(def.range / speed, tt + 0.15), flak ? 4 : 1.5, this.team, this.parent || this, 4, 0, null, 4, flak ? 22 : 0);
    if (Math.random() < 0.15) ctx.audio?.shot('aa', _v);
  }

  _launch(dt, ctx) {
    this.launchTimer -= dt;
    if (this.launchTimer > 0) return;
    this.launchTimer = this.def.launchEvery;
    if (ctx.entities.counts.enemiesAlive > 40) return;
    _v.set(0, 16, -140).applyQuaternion(this.quat).add(this.pos);
    const u = ctx.entities.spawnAir(this.def.launches, this.team, _v.x, _v.y + 30, _v.z, this.yaw, { speed: 120 });
    ctx.radio?.('carrier', 'Enemy carrier is launching fighters!');
    return u;
  }
}
