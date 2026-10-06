// Cluster bomb: bursts above the ground into a carpet of bomblets.
export default {
  id: 'clusterBomb', name: 'CBU-97 Cluster Bomb', short: 'CLUSTER', slot: 'secondary', class: 'BombWeapon', category: 'air-to-ground',
  price: 2500, description: 'Opens above the target and scatters 24 bomblets over a wide area. Perfect against groups of vehicles and air defences.',
  ordnance: 'bomb', guidance: 'none', ammo: 4, reload: 1, damage: 20, cluster: 24, bomblet: 'bomblet', spread: 55, burstHeight: 260,
  life: 40, armTime: 0.5, model: 'bomb', blast: 10,
};
