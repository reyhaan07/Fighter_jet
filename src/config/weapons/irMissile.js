// Short-range heat-seeker: growl while locking, solid tone when locked.
// Flares can decoy it.
export default {
  id: 'irMissile', name: 'AIM-9X Heat-Seeker', short: 'IR MSL', slot: 'secondary', class: 'MissileWeapon', category: 'air-to-air',
  price: 0, description: 'Short-range heat-seeking missile with a wide seeker. Lock tone growls while acquiring. Can be decoyed by flares.',
  seeker: 'ir', guidance: 'ir', lockTime: 1.1, range: 3800, minRange: 150, cone: 24, maxLocks: 1,
  ammo: 8, reload: 0.9, damage: 55, splash: 12, proximity: 9, speed: 820, accel: 520, burn: 2.6, life: 10,
  turnRate: 3.2, gimbal: 0.25, decoyResist: 0.25, lead: 0.9, model: 'missile', sound: 'missile',
};
