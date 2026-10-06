import { Weapon } from '../Weapon.js';

// Energy shield: absorbs all damage for a few seconds, then needs a long
// cooldown. Config: duration, reload

export class ShieldWeapon extends Weapon {
  update(dt, ctx, trig) {
    const o = this.owner;
    this.status = o.shieldActive > 0 ? 'ACTIVE' : this.cooldown > 0 ? `${Math.ceil(this.cooldown)}s` : 'READY';
    if (o.shieldActive > 0 && Math.random() < 0.4) ctx.fx.shieldHit(o.pos.x + (Math.random() - 0.5) * 16, o.pos.y + (Math.random() - 0.5) * 6, o.pos.z + (Math.random() - 0.5) * 16);
    if (!trig.pressed || this.cooldown > 0 || o.shieldActive > 0) return;
    o.shieldActive = this.def.duration;
    this.cooldown = this.reloadTime;
    if (o.isPlayer) {
      ctx.audio?.shield();
      ctx.hud?.message('SHIELD UP', 1.5, '#7fd4ff');
    }
  }

  hud() {
    const h = super.hud();
    h.ammo = Infinity;
    if (this.owner.shieldActive > 0) h.bar = { value: this.owner.shieldActive / this.def.duration, label: 'SHIELD', warn: false };
    else if (this.cooldown > 0) h.bar = { value: 1 - this.cooldown / this.reloadTime, label: '', warn: false };
    return h;
  }
}
