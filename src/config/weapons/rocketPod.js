// Unguided rocket pods for ripple-firing at ground targets.
export default {
  id: 'rocketPod', name: 'Hydra Rocket Pods', short: 'ROCKETS', slot: 'secondary', class: 'RocketPodWeapon', category: 'air-to-ground',
  price: 0, description: 'Unguided rockets. Hold to ripple-fire a stream of explosive rockets along your nose. Point and shoot.',
  ordnance: 'rocket', rpm: 480, spread: 0.012, ammo: 38, reload: 0.5, damage: 22, splash: 11, speed: 720, accel: 900, burn: 1.0, life: 5,
  armTime: 0.1, model: 'rocket', blast: 8, antiArmor: true,
};
