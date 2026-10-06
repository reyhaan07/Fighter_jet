export default {
  id: 'enemyIR', name: 'Enemy IR Missile', slot: 'secondary', class: 'MissileWeapon', hidden: true, category: 'air-to-air',
  seeker: 'ir', guidance: 'ir', lockTime: 2.4, range: 3000, minRange: 300, cone: 18, maxLocks: 1,
  ammo: 2, reload: 8, damage: 34, splash: 10, proximity: 8, speed: 700, accel: 420, burn: 2.4, life: 9,
  turnRate: 2.4, gimbal: 0.3, decoyResist: 0.1, lead: 0.85, model: 'missile',
};
