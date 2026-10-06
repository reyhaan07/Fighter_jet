import { Weapon } from '../Weapon.js';

// Flares (decoy heat-seekers) and chaff (decoy radar missiles). Each press
// releases a short burst of decoys.
// Config: decoy ('flare' | 'chaff'), burst, burstInterval, reload, ammo

export class CountermeasureWeapon extends Weapon {
  constructor(def, owner, opts) {
    super(def, owner, opts);
    this.burstLeft = 0;
    this.burstTimer = 0;
  }

  reset() {
    super.reset();
    this.burstLeft = 0;
  }

  update(dt, ctx, trig) {
    const d = this.def;
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = d.burstInterval;
        if (this.useAmmo(1)) ctx.ordnance.decoy(d.decoy, this.owner);
        this.burstLeft--;
      }
    }
    if ((trig.pressed || (trig.held && !this.owner.isPlayer)) && this.cooldown <= 0 && this.ammo >= 1) {
      this.burstLeft = d.burst;
      this.burstTimer = 0;
      this.cooldown = this.reloadTime;
      if (this.owner.isPlayer) ctx.audio?.countermeasure(d.decoy);
    }
    this.status = this.cooldown > 0 ? '' : 'READY';
  }

  hud() {
    return { ...super.hud(), name: this.short };
  }
}
