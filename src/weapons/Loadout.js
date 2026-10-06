import { createWeapon } from './registry.js';

// The weapons carried by one aircraft: a gun, up to three selectable
// secondary weapons, one defence system and flares.

export class Loadout {
  constructor(owner, slots, { upgrades = {}, ammoMult = 1, infinite = false } = {}) {
    this.owner = owner;
    const opts = (id) => ({ upgrades: upgrades[id], ammoMult, infinite });
    this.gun = slots.gun ? createWeapon(slots.gun, owner, opts(slots.gun)) : null;
    this.secondaries = [];
    for (const k of ['s1', 's2', 's3']) if (slots[k]) this.secondaries.push(createWeapon(slots[k], owner, opts(slots[k])));
    this.defense = slots.def ? createWeapon(slots.def, owner, opts(slots.def)) : null;
    this.flares = slots.flares === false ? null : createWeapon(slots.flares || 'flares', owner, opts('flares'));
    this.index = 0;
    this.all = [this.gun, ...this.secondaries, this.defense, this.flares].filter(Boolean);
    this._gunTrig = { held: false, pressed: false, released: false };
    this._secTrig = { held: false, pressed: false, released: false };
    this._defTrig = { held: false, pressed: false, released: false };
    this._flareTrig = { held: false, pressed: false, released: false };
    this._gunWas = false;
    this._flareWas = false;
    if (this.secondaries[0]) this.secondaries[0].selected = true;
  }

  get current() {
    return this.secondaries[this.index] || null;
  }

  select(i) {
    if (!this.secondaries.length) return;
    i = ((i % this.secondaries.length) + this.secondaries.length) % this.secondaries.length;
    if (i === this.index) return;
    const prev = this.current;
    if (prev) {
      prev.selected = false;
      prev.onDeselect();
    }
    this.index = i;
    this.current.selected = true;
    this.current.onSelect();
  }

  next(dir = 1) {
    this.select(this.index + dir);
  }

  update(dt, ctx, t) {
    for (let i = 0; i < this.all.length; i++) this.all[i].passive(dt, ctx);
    if (this.gun) {
      const g = this._gunTrig;
      g.held = t.gun;
      g.pressed = t.gun && !this._gunWas;
      g.released = !t.gun && this._gunWas;
      this._gunWas = t.gun;
      this.gun.update(dt, ctx, g);
    }
    const cur = this.current;
    if (cur) {
      const s = this._secTrig;
      s.held = t.secondary;
      s.pressed = t.secondaryPressed;
      s.released = t.secondaryReleased;
      cur.update(dt, ctx, s);
    }
    if (this.defense) {
      const d = this._defTrig;
      d.held = d.pressed = t.defense;
      d.released = false;
      this.defense.update(dt, ctx, d);
    }
    if (this.flares) {
      const f = this._flareTrig;
      f.held = t.flares;
      f.pressed = t.flares && !this._flareWas;
      this._flareWas = t.flares;
      this.flares.update(dt, ctx, f);
    }
  }

  refill() {
    for (const w of this.all) w.ammo = w.maxAmmo;
  }

  /** Back to a fresh state (pooled aircraft reuse their loadout). */
  reset() {
    for (const w of this.all) w.reset();
    this._gunWas = this._flareWas = false;
  }
}
