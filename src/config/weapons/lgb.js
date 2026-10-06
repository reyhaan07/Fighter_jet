// Laser-guided bomb: glides onto the point under your aim (or the selected ground target).
export default {
  id: 'lgb', name: 'GBU-12 Laser-Guided Bomb', short: 'LGB', slot: 'secondary', class: 'BombWeapon', category: 'air-to-ground',
  price: 1500, description: 'Guided bomb that glides onto whatever the laser designates: your selected ground target, or the spot under your aim reticle. Release from altitude.',
  ordnance: 'bomb', guidance: 'laser', ammo: 6, reload: 0.8, damage: 140, splash: 28, splashMult: 0.7, turnRate: 0.7, life: 40, armTime: 1,
  model: 'bomb', blast: 24, antiArmor: true,
};
