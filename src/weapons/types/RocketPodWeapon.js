import * as THREE from 'three';
import { Weapon } from '../Weapon.js';

// Unguided rocket pods: hold the trigger to ripple-fire rockets along the
// nose (with a little dispersion). Also used by attack helicopters.
// Config: rpm, speed, spread, damage, splash, ordnance params

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _rail = new THREE.Vector3();

export class RocketPodWeapon extends Weapon {
  constructor(def, owner, opts) {
    super(def, owner, opts);
    this.interval = 60 / def.rpm;
    this.accum = 0;
    this.side = 1;
  }

  update(dt, ctx, trig) {
    this.status = this.cooldown > 0 ? 'RELOAD' : '';
    if ((!trig.held && !trig.pressed) || this.cooldown > 0) {
      this.accum = 0;
      return;
    }
    this.accum += dt;
    if (trig.pressed) this.accum = Math.max(this.accum, this.interval); // first rocket leaves on the press
    while (this.accum >= this.interval) {
      this.accum -= this.interval;
      if (!this.useAmmo(1)) {
        this.cooldown = this.reloadTime;
        return;
      }
      this._fire(ctx);
    }
  }

  _fire(ctx) {
    const d = this.def;
    const o = this.owner;
    this.side = -this.side;
    _rail.set(2.4 * this.side, -0.6, 0.5);
    this.muzzle(_v, _rail);
    _d.copy(o.gunDir.lengthSq() > 0.5 ? o.gunDir : _d.set(0, 0, -1).applyQuaternion(o.quat));
    _d.x += (Math.random() - 0.5) * d.spread;
    _d.y += (Math.random() - 0.5) * d.spread;
    _d.z += (Math.random() - 0.5) * d.spread;
    _d.normalize();
    ctx.ordnance.launch(d, o, null, _v, _d, Math.max(100, o.vel.length()), { damage: this.damage });
    ctx.fx.muzzle(_v.x, _v.y, _v.z, 1.5);
    if (o.isPlayer) ctx.audio?.rocket();
    else if (Math.random() < 0.5) ctx.audio?.rocket(_v);
  }
}
