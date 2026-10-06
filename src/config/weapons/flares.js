// Flares: decoy heat-seeking missiles. Always carried (own button).
export default {
  id: 'flares', name: 'Flares', short: 'FLARE', slot: 'flares', class: 'CountermeasureWeapon', category: 'defence',
  price: 0, hidden: true, decoy: 'flare', burst: 4, burstInterval: 0.1, reload: 1.2, ammo: 48,
  description: 'Hot decoys that pull heat-seeking missiles away. Release just before the missile arrives.',
};
