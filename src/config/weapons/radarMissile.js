// Long-range radar missile: fire-and-forget, locks up to 4 targets.
export default {
  id: 'radarMissile', name: 'AIM-260 Long-Range', short: 'LR MSL', slot: 'secondary', class: 'MissileWeapon', category: 'air-to-air',
  price: 1800, description: 'Radar-guided fire-and-forget missile. Locks up to 4 targets at long range, then fires one missile at each. Chaff and ECM can break its track.',
  seeker: 'radar', guidance: 'radar', lockTime: 1.2, range: 11000, minRange: 400, cone: 35, maxLocks: 4,
  ammo: 8, reload: 2.5, damage: 50, vsArmor: 1, splash: 14, proximity: 12, speed: 1050, accel: 380, burn: 5, life: 22,
  turnRate: 1.7, gimbal: 0.1, decoyResist: 0.45, lead: 1, model: 'missile', volleyInterval: 0.22, sound: 'missileHeavy',
};
