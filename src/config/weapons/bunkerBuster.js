// Bunker buster: penetrates hardened targets.
export default {
  id: 'bunkerBuster', name: 'GBU-57 Bunker Buster', short: 'BUNKER', slot: 'secondary', class: 'BombWeapon', category: 'air-to-ground',
  price: 4000, description: 'Heavy laser-guided penetrator. Ignores armour and deals triple damage to bunkers and ships. Small blast radius.',
  ordnance: 'bomb', guidance: 'laser', ammo: 2, reload: 1.5, damage: 420, vsArmor: 3, splash: 18, splashMult: 0.5, turnRate: 0.6, life: 40, armTime: 1,
  model: 'bomb', blast: 30, antiArmor: true,
};
