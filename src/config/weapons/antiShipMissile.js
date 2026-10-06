// Anti-ship missile: sea-skimming, huge damage against ships.
export default {
  id: 'antiShipMissile', name: 'Harpoon-X Anti-Ship', short: 'ASM', slot: 'secondary', class: 'MissileWeapon', category: 'air-to-ground',
  price: 3500, description: 'Heavy sea-skimming missile that only locks ships. Flies at wave height to dodge defences, then pops up for a crushing hit (×3 damage vs ships).',
  seeker: 'ship', guidance: 'radar', lockTime: 1.5, range: 14000, minRange: 600, cone: 40, maxLocks: 1,
  ammo: 4, reload: 2.5, damage: 120, vsShip: 3, splash: 25, proximity: 14, speed: 520, accel: 200, burn: 30, life: 40,
  turnRate: 1.2, gimbal: 0, decoyResist: 0.6, lead: 1, seaSkim: true, model: 'missileBig', blast: 22, trailScale: 1.4, glow: 3.4, sound: 'missileHeavy',
};
