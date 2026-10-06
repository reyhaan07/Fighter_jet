import * as THREE from 'three';
import { Weapon } from '../Weapon.js';

// Automatic projectile guns: 20 mm rotary (overheats), 30 mm autocannon
// (explosive shells), plasma cannon (energy, splash) and enemy/AA guns.
//
// Config: rpm, speed, range, damage, spread, splash, style, recoil,
//         heatPerShot/coolRate/overheatTime (optional), regen (energy weapons),
//         spinUp (rotary barrels), sound, muzzle [x,y,z] (aircraft space)

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();

export class GunWeapon extends Weapon {
  constructor(def, owner, opts) {
    super(def, owner, opts);
    this.interval = 60 / def.rpm;
    this.accum = 0;
    this.heat = 0;
    this.overheated = 0;
    this.spin = 0;
    this.firing = false;
    this.muzzleLocal = new THREE.Vector3(...(def.muzzle || [0.9, 0.2, -5.5]));
    this.side = 1;
  }

  passive(dt, ctx) {
    super.passive(dt, ctx);
    const d = this.def;
    if (d.heatPerShot) {
      if (this.overheated > 0) {
        this.overheated -= dt;
        this.heat = Math.max(0, this.heat - d.coolRate * dt * 1.5);
      } else if (!this.firing) this.heat = Math.max(0, this.heat - d.coolRate * dt);
    }
    if (!this.firing) this.spin = Math.max(0, this.spin - dt * 2);
  }

  update(dt, ctx, trig) {
    const d = this.def;
    this.firing = trig.held && this.overheated <= 0 && (this.ammo >= 1 || this.infinite);
    if (!this.firing) {
      this.accum = Math.min(this.accum, 0);
      if (this.owner.isPlayer) ctx.audio?.gunStop(this.id);
      this.status = this.overheated > 0 ? 'OVERHEAT' : '';
      return;
    }
    if (d.spinUp) {
      this.spin = Math.min(1, this.spin + dt / d.spinUp);
      if (this.spin < 0.25) return;
    } else this.spin = 1;
    this.accum += dt * this.spin;
    while (this.accum >= this.interval) {
      this.accum -= this.interval;
      if (!this.useAmmo(1)) break;
      this.fireRound(ctx);
      if (d.heatPerShot) {
        this.heat += d.heatPerShot;
        if (this.heat >= 1) {
          this.heat = 1;
          this.overheated = d.overheatTime;
          this.firing = false;
          ctx.audio?.overheat(this.owner);
          break;
        }
      }
    }
    if (this.owner.isPlayer) ctx.audio?.gunLoop(this.id, d.sound, this.spin);
    this.status = this.overheated > 0 ? 'OVERHEAT' : '';
  }

  fireRound(ctx) {
    const d = this.def;
    const o = this.owner;
    this.side = -this.side;
    _p.copy(this.muzzleLocal);
    if (d.alternate) _p.x *= this.side;
    this.muzzle(_p, _p);
    _d.copy(o.gunDir);
    // Random cone spread.
    _r.set(1, 0, 0).applyQuaternion(o.quat);
    _u.set(0, 1, 0).applyQuaternion(o.quat);
    const a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(Math.random()) * d.spread * (o.spreadMult || 1);
    _d.addScaledVector(_r, Math.cos(a) * s).addScaledVector(_u, Math.sin(a) * s).normalize();
    const v = d.speed;
    const style = o.team === 0 ? (o.isPlayer ? d.style : d.styleAlly ?? 5) : (d.styleEnemy ?? (d.style <= 1 ? 3 : d.style));
    ctx.bullets.spawn(
      _p.x, _p.y, _p.z,
      _d.x * v + o.vel.x, _d.y * v + o.vel.y, _d.z * v + o.vel.z,
      d.range / v, this.damage, o.team, o, style, d.splash || 0, d, d.gravity ?? 4,
    );
    ctx.fx.muzzle(_p.x, _p.y, _p.z, d.muzzleSize || 1);
    if (o.isPlayer) {
      ctx.stats.shots++;
      if (d.recoil) ctx.shake(d.recoil);
      if (!d.spinUp) ctx.audio?.shot(d.sound, null);
    } else if (Math.random() < 0.35) ctx.audio?.shot(d.sound, _p);
  }

  hud() {
    const h = super.hud();
    if (this.def.heatPerShot) h.bar = { value: this.heat, label: 'HEAT', warn: this.overheated > 0 };
    if (this.def.regen) h.bar = { value: this.ammo / this.maxAmmo, label: 'ENERGY', warn: this.ammo < 1 };
    return h;
  }
}
