// EMP burst: disables nearby enemies.
export default {
  id: 'emp', name: 'EMP Burst', short: 'EMP', slot: 'secondary', class: 'EmpWeapon', category: 'special',
  price: 6500, description: 'Electromagnetic pulse around your jet. Enemy aircraft and defences within 1.6 km lose power for 6 seconds and missiles in flight are fried.',
  radius: 1600, duration: 6, damage: 6, ammo: 3, reload: 20,
};
