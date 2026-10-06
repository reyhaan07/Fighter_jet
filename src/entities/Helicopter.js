import * as THREE from 'three';
import { Unit } from './Unit.js';
import { clamp } from '../core/math.js';

// Attack helicopter: hover physics instead of the jet flight model. Holds a
// low altitude near its home point, turns to face hostiles, strafes with its
// gun and rockets, and spins down in flames when killed.

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class Helicopter extends Unit {
  constructor() {
    super();
    this.home = new THREE.Vector3();
    this.yaw = 0;
    this.tiltX = 0;
    this.tiltZ = 0;
    this.dying = 0;
    this.skill = 0.5;
    this.loadout = null;
    this.trigger = { gun: false, secondary: false, secondaryPressed: false, secondaryReleased: false, defense: false, flares: false };
    this.gunDir = new THREE.Vector3();
    this.target = null;
    this.orbit = 0;
    this.capsuleHalf = 5;
    this.noFall = false;
    this.shieldActive = 0;
    this.ecm = 0;
  }

  spawnHeli(def, team, x, y, z, yaw) {
    this.baseSpawn(def, team, x, y, z);
    this.kind = 'air';
    this.isAir = true;
    this.home.set(x, y, z);
    this.yaw = yaw;
    this.dying = 0;
    this.heat = 0.6;
    this.orbit = Math.random() * 6.28;
    this.capsuleHalf = def.capsuleHalf ?? 5;
    this.paint.set(def.paint ?? 0xffffff);
    this.target = null;
    this.loadout = null;
    this.flight = null;
    const t = this.trigger;
    t.gun = t.secondary = t.secondaryPressed = t.secondaryReleased = t.flares = t.defense = false;
    return this;
  }

  startDying() {
    this.dying = 2.5;
    this.alive = false;
  }

  update(dt, ctx) {
    if (this.dying > 0) {
      this.dying -= dt;
      this.yaw += dt * 5;
      this.vel.y -= 9.81 * dt;
      this.pos.addScaledVector(this.vel, dt);
      this.quat.setFromEuler(_e.set(0.3, this.yaw, 0.4));
      if (Math.random() < 0.7) ctx.fx.burningTrail(this);
      if (this.dying <= 0 || this.pos.y < ctx.world.surfaceAt(this.pos.x, this.pos.z) + 2) ctx.combat.finalExplosion(this);
      return;
    }
    if (this.disabled > 0) {
      this.disabled -= dt;
      this.vel.y -= 4 * dt;
    } else this._think(dt, ctx);

    this.pos.addScaledVector(this.vel, dt);
    const ground = ctx.world.surfaceAt(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 4) {
      this.pos.y = ground + 4;
      if (this.disabled > 0) ctx.combat.kill(this, null, 'ground');
    }
    _e.set(this.tiltX, this.yaw, this.tiltZ);
    this.quat.setFromEuler(_e);
    if (this.loadout) this.loadout.update(dt, ctx, this.trigger);
  }

  _think(dt, ctx) {
    // Target: nearest hostile aircraft within 4 km of home.
    let best = null;
    let bestD = 4000 * 4000;
    const air = ctx.entities.air;
    for (let i = 0; i < air.length; i++) {
      const a = air[i];
      if (!a.alive || a.team === this.team) continue;
      const d = a.pos.distanceToSquared(this.pos);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    this.target = best;
    const ground = ctx.world.surfaceAt(this.pos.x, this.pos.z);
    this.orbit += dt * 0.15;
    // Hover point: circle around home, low over the ground.
    _v.set(this.home.x + Math.cos(this.orbit) * 500, Math.max(ground, ctx.world.surfaceAt(this.home.x, this.home.z)) + 140, this.home.z + Math.sin(this.orbit) * 500);
    _d.copy(_v).sub(this.pos);
    const dist = _d.length();
    const speed = Math.min(55, dist * 0.3);
    _d.normalize().multiplyScalar(speed);
    this.vel.lerp(_d, 1 - Math.exp(-1.2 * dt));
    let wantYaw = Math.atan2(-this.vel.x, -this.vel.z);
    const t = this.trigger;
    t.gun = t.secondary = t.secondaryPressed = false;
    if (best) {
      _d.copy(best.pos).sub(this.pos);
      const td = _d.length();
      wantYaw = Math.atan2(-_d.x, -_d.z);
      this.gunDir.copy(_d).normalize();
      _q.setFromEuler(_e.set(0, this.yaw, 0));
      _v.set(0, 0, -1).applyQuaternion(_q);
      const facing = _v.x * this.gunDir.x + _v.z * this.gunDir.z;
      if (td < 1800 && facing > 0.92 - (1 - this.skill) * 0.05) t.gun = true;
      if (td < 2600 && td > 600 && facing > 0.95 && Math.random() < dt * 0.5) {
        t.secondary = t.secondaryPressed = true;
      }
    } else this.gunDir.set(0, 0, -1).applyQuaternion(this.quat);
    let dy = wantYaw - this.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.yaw += clamp(dy, -1.2 * dt, 1.2 * dt);
    // Visual tilt from velocity in the body frame.
    const c = Math.cos(this.yaw);
    const s = Math.sin(this.yaw);
    const fwdV = -this.vel.x * s - this.vel.z * c;
    const sideV = this.vel.x * c - this.vel.z * s;
    this.tiltX += (-fwdV * 0.006 - this.tiltX) * Math.min(1, dt * 2);
    this.tiltZ += (-sideV * 0.008 - this.tiltZ) * Math.min(1, dt * 2);
  }
}
