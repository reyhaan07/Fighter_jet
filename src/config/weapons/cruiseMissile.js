// Cruise missile with a steerable nose camera.
export default {
  id: 'cruiseMissile', name: 'Tomahawk-C (TV-guided)', short: 'CRUISE', slot: 'secondary', class: 'CruiseMissileWeapon', category: 'air-to-ground',
  price: 6000, description: 'Launch, then fly the missile yourself through its nose camera. Fire again to detonate early. Enormous blast that wrecks anything nearby.',
  ordnance: 'cruise', guidance: 'none', ammo: 2, reload: 3, damage: 260, splash: 60, splashMult: 0.8, speed: 320, accel: 120, burn: 60, life: 35,
  turnRate: 1.3, armTime: 0.6, model: 'cruise', blast: 45, antiArmor: true, vsShip: 2,
};
