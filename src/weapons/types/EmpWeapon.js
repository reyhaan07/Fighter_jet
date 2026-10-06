import { Weapon } from '../Weapon.js';

// EMP burst centred on the aircraft: disables enemy aircraft, SAMs and AA in
// range for a few seconds (they drift, can't fire or lock) and fries
// missiles in flight. Config: radius, duration, damage, reload

export class EmpWeapon extends Weapon {
  update(dt, ctx, trig) {
    this.status = this.cooldown > 0 ? `${Math.ceil(this.cooldown)}s` : 'READY';
    if (!trig.pressed || this.cooldown > 0 || !this.useAmmo(1)) return;
    this.cooldown = this.reloadTime;
    ctx.emp(this.owner.pos, this.def, this.owner);
    if (this.owner.isPlayer) ctx.shake(0.4);
  }

  hud() {
    const h = super.hud();
    if (this.cooldown > 0) h.bar = { value: 1 - this.cooldown / this.reloadTime, label: 'CHARGE', warn: false };
    return h;
  }
}
