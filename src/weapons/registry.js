// Weapon registry. Every file in src/config/weapons/ exports a default config
// object; every file in src/weapons/types/ exports a class with the same name
// as the file. Vite's import.meta.glob bundles them all at build time, so adding
// a weapon means dropping in one config file (+ one class if it needs new
// behaviour). Nothing else to register.

const defModules = import.meta.glob('../config/weapons/*.js', { eager: true });
const classModules = import.meta.glob('./types/*.js', { eager: true });

export const WEAPONS = {};
for (const mod of Object.values(defModules)) {
  const def = mod.default;
  if (def?.id) WEAPONS[def.id] = def;
}

export const WEAPON_CLASSES = {};
for (const [path, mod] of Object.entries(classModules)) {
  const name = path.split('/').pop().replace('.js', '');
  if (mod[name]) WEAPON_CLASSES[name] = mod[name];
}

export function createWeapon(id, owner, opts) {
  const def = WEAPONS[id];
  if (!def) throw new Error('Unknown weapon: ' + id);
  const Cls = WEAPON_CLASSES[def.class];
  if (!Cls) throw new Error(`Weapon ${id} uses unknown class ${def.class}`);
  return new Cls(def, owner, opts);
}

/** Weapons usable in a slot type, sorted for the hangar. */
export function weaponsForSlot(slot) {
  return Object.values(WEAPONS)
    .filter((w) => w.slot === slot && !w.hidden)
    .sort((a, b) => (a.price || 0) - (b.price || 0));
}
