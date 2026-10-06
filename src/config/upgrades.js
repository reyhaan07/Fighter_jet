// Weapon upgrades bought with credits in the hangar. Three levels each.
//   damage +15 % per level, reload −12 % per level, lock time −15 % per level
export const UPGRADES = {
  damage: { label: 'Damage', costs: [600, 1400, 3000], applies: () => true },
  reload: { label: 'Reload / cooldown', costs: [500, 1200, 2600], applies: (w) => (w.reload ?? 0) > 0 },
  lock: { label: 'Lock speed', costs: [500, 1200, 2600], applies: (w) => (w.lockTime ?? 0) > 0 },
};
export const MAX_LEVEL = 3;
