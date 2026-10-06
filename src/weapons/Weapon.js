// Base class for every weapon. A weapon = one config object (src/config/weapons/<id>.js)
// + one behaviour class (src/weapons/types/<Class>.js). See README "Adding a weapon".
//
// Lifecycle per simulation step:
//   passive(dt, ctx)                 always (reload, cooling, regen)
//   update(dt, ctx, trigger)         only while selected; trigger = { held, pressed, released }
//   hud()                            text/numbers for the HUD weapon panel

export class Weapon {
  constructor(def, owner, { upgrades = {}, ammoMult = 1, infinite = false } = {}) {
    this.def = def;
    this.owner = owner;
    this.id = def.id;
    this.name = def.name;
    this.short = def.short || def.name;
    const up = upgrades || {};
    this.level = { damage: up.damage || 0, reload: up.reload || 0, lock: up.lock || 0 };
    this.damage = (def.damage || 0) * (1 + 0.15 * this.level.damage);
    this.reloadTime = (def.reload || 0) * (1 - 0.12 * this.level.reload);
    this.lockTime = (def.lockTime || 0) * (1 - 0.15 * this.level.lock);
    const groundMult = def.category === 'air-to-ground' ? ammoMult : 1;
    this.maxAmmo = Math.max(1, Math.round((def.ammo ?? 1) * groundMult));
    this.ammo = this.maxAmmo;
    this.infinite = infinite;
    this.cooldown = 0;
    this.status = '';
    this.selected = false;
  }

  get ready() {
    return this.cooldown <= 0 && (this.ammo > 0 || this.infinite);
  }

  useAmmo(n = 1) {
    if (this.infinite) return true;
    if (this.ammo < n) return false;
    this.ammo -= n;
    return true;
  }

  passive(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
    if (this.def.regen && this.ammo < this.maxAmmo) this.ammo = Math.min(this.maxAmmo, this.ammo + this.def.regen * dt);
  }

  // eslint-disable-next-line no-unused-vars
  update(dt, ctx, trigger) {}

  /** Restore full ammo and clear transient state (aircraft respawn from pool). */
  reset() {
    this.ammo = this.maxAmmo;
    this.cooldown = 0;
    this.status = '';
  }

  onSelect() {}
  onDeselect() {}

  hud() {
    return { name: this.short, ammo: this.infinite ? Infinity : Math.floor(this.ammo), max: this.maxAmmo, status: this.status, bar: null };
  }

  /** Spawn point in world space from an aircraft-local offset. */
  muzzle(out, local) {
    return out.copy(local).applyQuaternion(this.owner.quat).add(this.owner.pos);
  }
}
