// Electromagnetic railgun: charge, release, pierce.
export default {
  id: 'railgun', name: 'EM-9 Railgun', short: 'RAILGUN', slot: 'gun', class: 'RailgunWeapon', category: 'gun',
  price: 7000, description: 'Hold to charge, release to fire a hypersonic slug. Instant hit along a line and pierces up to 4 targets. Long recharge.',
  chargeTime: 1.4, minCharge: 0.2, range: 6000, damage: 70, pierce: 4, ammo: 40, reload: 1.2, sound: 'railgun',
};
