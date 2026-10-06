export default {
  id: 'enemyRadar', name: 'Enemy Radar Missile', slot: 'secondary', class: 'MissileWeapon', hidden: true, category: 'air-to-air',
  seeker: 'radar', guidance: 'radar', lockTime: 3.0, range: 7000, minRange: 500, cone: 25, maxLocks: 1,
  ammo: 2, reload: 12, damage: 34, splash: 12, proximity: 10, speed: 850, accel: 320, burn: 4, life: 16,
  turnRate: 1.5, gimbal: 0.15, decoyResist: 0.2, lead: 1, model: 'missile',
};
