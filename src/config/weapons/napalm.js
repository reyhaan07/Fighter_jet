// Napalm: leaves a burning area that damages anything inside.
export default {
  id: 'napalm', name: 'Mk-77 Napalm', short: 'NAPALM', slot: 'secondary', class: 'BombWeapon', category: 'air-to-ground',
  price: 3000, description: 'Incendiary canister. Splashes a sea of fire that keeps burning for 12 seconds, damaging everything inside it.',
  ordnance: 'bomb', guidance: 'none', ammo: 4, reload: 0.8, damage: 30, splash: 30, life: 40, armTime: 0.5, model: 'bomb', blast: 16,
  napalm: { radius: 70, dps: 26, life: 12 },
};
