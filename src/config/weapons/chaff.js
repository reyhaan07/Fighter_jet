// Chaff: decoys radar-guided missiles (SAMs, long-range missiles).
export default {
  id: 'chaff', name: 'Chaff Dispenser', short: 'CHAFF', slot: 'def', class: 'CountermeasureWeapon', category: 'defence',
  price: 0, decoy: 'chaff', burst: 3, burstInterval: 0.12, reload: 1.5, ammo: 36,
  description: 'Clouds of foil that confuse radar-guided missiles and SAMs. Does nothing against heat-seekers.',
};
