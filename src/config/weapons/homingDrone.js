// Deployable homing drone that hunts enemies for you.
export default {
  id: 'homingDrone', name: 'Wasp Combat Drone', short: 'DRONE', slot: 'secondary', class: 'DroneWeapon', category: 'special',
  price: 5000, description: 'Deploys an autonomous drone that escorts you and hunts the nearest enemy with plasma bolts for 25 seconds. Up to 2 at once.',
  ordnance: 'drone', guidance: 'none', ammo: 4, reload: 3, life: 25, range: 3500, speed: 280, fireInterval: 0.45, boltDamage: 6, damage: 0,
  maxActive: 2, model: 'droneSmall',
};
