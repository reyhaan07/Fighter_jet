import { Weapon } from '../Weapon.js';

// ECM jammer: for a few seconds enemy radars see you at a fraction of the
// range, AI lock-ons stall and radar-guided missiles may lose track.
// Config: duration, reload

export class EcmWeapon extends Weapon {
  update(dt, ctx, trig) {
    const o = this.owner;
    this.status = o.ecm > 0 ? 'ACTIVE' : this.cooldown > 0 ? `${Math.ceil(this.cooldown)}s` : 'READY';
    if (!trig.pressed || this.cooldown > 0 || o.ecm > 0) return;
    o.ecm = this.def.duration;
    this.cooldown = this.reloadTime;
    if (o.isPlayer) {
      ctx.audio?.ecm();
      ctx.hud?.message('ECM JAMMING', 1.5, '#7fd4ff');
    }
  }

  hud() {
    const h = super.hud();
    h.ammo = Infinity;
    if (this.owner.ecm > 0) h.bar = { value: this.owner.ecm / this.def.duration, label: 'ECM', warn: false };
    else if (this.cooldown > 0) h.bar = { value: 1 - this.cooldown / this.reloadTime, label: '', warn: false };
    return h;
  }
}
