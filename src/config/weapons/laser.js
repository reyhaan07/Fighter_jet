// Sustained laser beam; drains energy.
export default {
  id: 'laser', name: 'Helios Laser', short: 'LASER', slot: 'secondary', class: 'LaserWeapon', category: 'special',
  price: 8000, description: 'Continuous beam that burns anything under the crosshair at the speed of light. Drains energy fast; recharges when idle.',
  damage: 34, range: 3500, ammo: 100, drain: 22, regen: 12, lockout: 2.5, sound: 'laser',
};
