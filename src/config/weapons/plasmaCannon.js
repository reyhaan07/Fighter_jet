// Plasma cannon: slow glowing bolts with splash, energy recharges.
export default {
  id: 'plasmaCannon', name: 'Plasma Cannon', short: 'PLASMA', slot: 'secondary', class: 'GunWeapon', category: 'special',
  price: 5500, description: 'Fires slow, glowing plasma bolts that burst on impact. Runs on rechargeable energy instead of ammo.',
  rpm: 300, speed: 650, range: 2600, damage: 16, splash: 10, spread: 0.002, ammo: 40, regen: 5, gravity: 0,
  style: 2, muzzleSize: 3, sound: 'plasma', muzzle: [0, -0.8, -8],
};
