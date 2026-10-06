import * as THREE from 'three';
import { Weapon } from '../Weapon.js';

// Cruise missile with a nose camera you steer yourself. While it flies the
// view switches to its camera; the jet holds its heading on autopilot. Press
// fire again to detonate early. Big blast.

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export class CruiseMissileWeapon extends Weapon {
  update(dt, ctx, trig) {
    this.status = ctx.ordnance.cruise ? 'GUIDING' : this.cooldown > 0 ? 'RELOAD' : 'READY';
    if (!trig.pressed || ctx.ordnance.cruise || this.cooldown > 0 || !this.useAmmo(1)) return;
    const o = this.owner;
    this.cooldown = this.reloadTime;
    _p.set(0, -1.2, 0).applyQuaternion(o.quat).add(o.pos);
    _d.set(0, 0, -1).applyQuaternion(o.quat);
    const m = ctx.ordnance.launch(this.def, o, null, _p, _d, Math.max(150, o.vel.length()), { steer: o.isPlayer, damage: this.damage });
    if (m && o.isPlayer) {
      m.guideDir.copy(_d);
      ctx.audio?.missileLaunch('missileHeavy');
      ctx.hud?.message('CRUISE MISSILE AWAY — STEER IT', 2.5);
    }
  }
}
