import * as THREE from 'three';
import { Weapon } from '../Weapon.js';

// Free-fall and guided bombs: laser-guided (rides the designator point under
// your aim or the selected ground target), cluster (bursts into bomblets),
// bunker buster (armour piercing) and napalm (leaves a fire zone).
// Config: guidance ('laser' | 'none'), cluster, bomblet, napalm, damage, splash

const _p = new THREE.Vector3();
const _rail = new THREE.Vector3();

export class BombWeapon extends Weapon {
  constructor(def, owner, opts) {
    super(def, owner, opts);
    this.side = 1;
  }

  update(dt, ctx, trig) {
    this.status = this.cooldown > 0 ? 'RELOAD' : this.def.guidance === 'laser' ? 'DESIGNATE' : 'CCIP';
    if (!trig.pressed || this.cooldown > 0 || !this.useAmmo(1)) return;
    const d = this.def;
    const o = this.owner;
    this.cooldown = this.reloadTime;
    this.side = -this.side;
    _rail.set(1.6 * this.side, -0.9, 1);
    this.muzzle(_p, _rail);
    const sp = o.vel.length();
    const dir = o.vel.clone().normalize(); // once per drop, not per frame
    let target = null;
    if (d.guidance === 'laser') {
      const t = o.target;
      if (t && t.alive && !t.isAir) target = t;
    }
    // Laser spot where the pilot aims; if that misses the ground, the bomb's
    // own predicted impact point (never back up to the release point).
    const aim = o.isPlayer ? ctx.groundAim() || ctx.bombImpact() : null;
    ctx.ordnance.launch(d, o, target, _p, dir, sp, { damage: this.damage, aimPoint: aim || _p });
    if (o.isPlayer) ctx.audio?.bombRelease();
  }
}
