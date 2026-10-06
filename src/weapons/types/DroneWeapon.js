import * as THREE from 'three';
import { Weapon } from '../Weapon.js';

// Deploys an autonomous homing drone that escorts you, hunts the nearest
// enemy and shoots plasma bolts until its battery runs out.
// Config: life, range, speed, fireInterval, boltDamage, maxActive

const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

export class DroneWeapon extends Weapon {
  update(dt, ctx, trig) {
    let active = 0;
    for (const o of ctx.ordnance.active) if (o.kind === 'drone' && o.owner === this.owner) active++;
    this.status = active ? `${active} ACTIVE` : this.cooldown > 0 ? 'RELOAD' : 'READY';
    if (!trig.pressed || this.cooldown > 0 || active >= this.def.maxActive || !this.useAmmo(1)) return;
    const o = this.owner;
    this.cooldown = this.reloadTime;
    _p.set(0, -2, 6).applyQuaternion(o.quat).add(o.pos);
    _d.set(0, 0, -1).applyQuaternion(o.quat);
    ctx.ordnance.launch(this.def, o, null, _p, _d, o.vel.length() * 0.8, { damage: this.def.damage });
    if (o.isPlayer) ctx.audio?.droneDeploy();
  }
}
