// Micro-missile swarm: a volley of 12 small missiles split across up to 4 locks.
export default {
  id: 'swarmMissile', name: 'Hornet Swarm Pod', short: 'SWARM', slot: 'secondary', class: 'MissileWeapon', category: 'air-to-air',
  price: 4500, description: 'Fires a volley of 12 micro-missiles that split between up to 4 locked targets. Weak alone, devastating together. Without a lock they spread straight ahead.',
  seeker: 'ir', guidance: 'ir', lockTime: 0.6, range: 3200, minRange: 120, cone: 30, maxLocks: 4,
  volley: 12, ammoPerMissile: 1, ammo: 48, reload: 4, damage: 14, splash: 7, proximity: 6, speed: 760, accel: 900, burn: 1.8, life: 6,
  turnRate: 3.8, gimbal: 0.1, decoyResist: 0.35, lead: 0.8, wobble: 0.08, spreadLaunch: 0.25, volleyInterval: 0.04,
  model: 'microMissile', trailScale: 0.5, glow: 1.4, sound: 'swarm', rails: [[2.2, -0.5, 1], [2.6, -0.5, 1.4]],
};
