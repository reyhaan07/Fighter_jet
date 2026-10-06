// Campaign missions. Each mission describes its environment, player start,
// wingmen, rewards and a setup(api) script that places units and objectives.
// The api is implemented in src/game/modes/Mission.js:
//
//   api.air(type, count, { x, z, alt, spread, objective, waypoint, delay })
//   api.ground(type, count, { x, z, spread, objective, path })
//   api.sea(type, count, { x, z, spread, objective, path })
//   api.convoy(type, count, { from, to, objective })       moving ground column
//   api.friendly(type, count, { x, z, alt, to, objective }) escorted transports
//   api.boss({ x, z, alt })                                 the flying fortress
//   api.objective(id, label, { kind, group, count, failIfLost, zone })
//   api.waves([{ at: seconds | 'cleared', spawn: (api) => {} }])
//
// Objective kinds: destroy (kill `count` of group), protect (keep units of
// group alive; failIfLost = how many may die), intercept (no unit of group may
// reach zone {x,z,r}), escort (group must reach zone), boss.

export const MISSIONS = [
  {
    id: 'm1',
    name: 'First Light',
    type: 'Air superiority',
    brief:
      'Enemy fighters are probing our northern islands at dawn. Take off with Viper 2, find the patrol and clear the sky. Use your 20 mm cannon up close and heat-seekers when you get the growl.',
    env: { time: 'dusk', terrain: 'islands', seed: 11, cloudiness: 0.8 },
    start: { x: 0, z: 9000, alt: 1500, yaw: 0 },
    wingmen: 1,
    reward: 1200,
    recommended: ['cannon20', 'irMissile'],
    setup(api) {
      api.objective('fighters', 'Destroy enemy fighters', { kind: 'destroy', group: 'fighters', count: 8 });
      api.air('fighter', 4, { x: 0, z: 1000, alt: 1800, spread: 1500, objective: 'fighters' });
      api.waves([{ at: 'cleared', spawn: (a) => a.air('fighter', 4, { x: 2000, z: -2000, alt: 2200, spread: 1500, objective: 'fighters' }) }]);
    },
  },
  {
    id: 'm2',
    name: 'Iron Rain',
    type: 'Ground strike',
    brief:
      'A SAM belt guards the desert pass. Destroy the four SAM launchers and the radar station that feeds them. AA guns cover the site and a small CAP is airborne. Rockets, laser-guided bombs and cluster bombs are your friends.',
    env: { time: 'day', terrain: 'desert', seed: 23, cloudiness: 0.4 },
    start: { x: -8000, z: 8000, alt: 1800, yaw: -Math.PI / 4 },
    wingmen: 1,
    reward: 1600,
    recommended: ['rocketPod', 'lgb', 'clusterBomb'],
    setup(api) {
      api.objective('sams', 'Destroy SAM launchers', { kind: 'destroy', group: 'sams', count: 4 });
      api.objective('radar', 'Destroy the radar station', { kind: 'destroy', group: 'radar', count: 1 });
      api.ground('sam', 4, { x: 0, z: 0, spread: 2500, objective: 'sams' });
      api.ground('radar', 1, { x: 300, z: 200, spread: 200, objective: 'radar' });
      api.ground('aa', 6, { x: 0, z: 0, spread: 2200 });
      api.ground('tank', 6, { x: -500, z: 600, spread: 1500 });
      api.ground('truck', 6, { x: 400, z: -400, spread: 1500 });
      api.air('fighter', 2, { x: 1000, z: -1000, alt: 2000, spread: 800 });
    },
  },
  {
    id: 'm3',
    name: 'Shepherd',
    type: 'Escort',
    brief:
      'Three transports are flying medical supplies to the coast. Interceptors will try to pick them off. Stay close, keep them alive: we can afford to lose one. Tell your wingman to cover you (G) or attack your target (Z).',
    env: { time: 'dusk', terrain: 'coast', seed: 37, cloudiness: 1 },
    start: { x: -9500, z: 6000, alt: 2000, yaw: -Math.PI / 2 },
    wingmen: 1,
    reward: 2000,
    recommended: ['radarMissile', 'irMissile'],
    setup(api) {
      api.friendly('transport', 3, { x: -9000, z: 6000, alt: 1900, to: { x: 9000, z: -4000 }, objective: 'convoy' });
      api.objective('convoy', 'Protect the transports (lose at most 1)', { kind: 'protect', group: 'convoy', failIfLost: 1 });
      api.objective('arrive', 'Escort the transports to the coast', { kind: 'escort', group: 'convoy', zone: { x: 9000, z: -4000, r: 1500 } });
      api.waves([
        { at: 15, spawn: (a) => a.air('interceptor', 3, { x: -2000, z: -3000, alt: 2500, spread: 1500 }) },
        { at: 55, spawn: (a) => a.air('fighter', 4, { x: 4000, z: 2000, alt: 2000, spread: 1500 }) },
        { at: 95, spawn: (a) => a.air('interceptor', 4, { x: 6000, z: -6000, alt: 2500, spread: 1500 }) },
      ]);
    },
  },
  {
    id: 'm4',
    name: 'Heavy Weather',
    type: 'Intercept',
    brief:
      'A bomber formation with fighter escort is heading for Port Arden. Not one bomber may reach the city. Long-range missiles let you engage before the escort reacts.',
    env: { time: 'day', terrain: 'ocean', seed: 41, cloudiness: 1.6, cloudBase: 1400 },
    start: { x: 0, z: 9000, alt: 2400, yaw: 0 },
    wingmen: 1,
    reward: 2200,
    recommended: ['radarMissile', 'swarmMissile'],
    setup(api) {
      const city = { x: 0, z: 10500, r: 2500 };
      api.objective('bombers', 'Shoot down every bomber before it reaches the city', { kind: 'intercept', group: 'bombers', zone: city });
      api.air('bomber', 6, { x: 0, z: -9000, alt: 2600, spread: 900, objective: 'bombers', waypoint: { x: 0, y: 2600, z: 10500 } });
      api.air('fighter', 4, { x: 0, z: -8000, alt: 3000, spread: 1500 });
      api.waves([{ at: 40, spawn: (a) => a.air('interceptor', 3, { x: 0, z: -9000, alt: 3000, spread: 1500 }) }]);
    },
  },
  {
    id: 'm5',
    name: 'Coastal Fury',
    type: 'Anti-ship',
    brief:
      'An enemy surface group is shelling the coast. Sink both frigates and the destroyer. Their SAMs are radar-guided: chaff and ECM help. Anti-ship missiles hug the waves and hit three times harder against ships.',
    env: { time: 'day', terrain: 'coast', seed: 53, cloudiness: 0.6 },
    start: { x: 0, z: 9500, alt: 1500, yaw: 0 },
    wingmen: 1,
    reward: 2600,
    recommended: ['antiShipMissile', 'lgb', 'chaff'],
    setup(api) {
      api.objective('ships', 'Sink the surface group', { kind: 'destroy', group: 'ships', count: 3 });
      api.sea('frigate', 2, { x: 0, z: -2000, spread: 2500, objective: 'ships', patrol: 2500 });
      api.sea('destroyer', 1, { x: 500, z: -3000, spread: 500, objective: 'ships', patrol: 2000 });
      api.air('fighter', 3, { x: 0, z: -3000, alt: 1800, spread: 1500 });
      api.waves([{ at: 'cleared', spawn: (a) => a.air('fighter', 2, { x: 0, z: -6000, alt: 2000, spread: 1000 }) }]);
    },
  },
  {
    id: 'm6',
    name: 'Night Hammer',
    type: 'Night strike',
    brief:
      'Under cover of darkness, hit the mountain weapons depot: three hardened bunkers and their fuel tanks. Bunkers shrug off normal bombs, so bring bunker busters. Attack helicopters guard the valley.',
    env: { time: 'night', terrain: 'mountains', seed: 67, cloudiness: 0.7 },
    start: { x: 8000, z: 8000, alt: 2600, yaw: Math.PI / 4 },
    wingmen: 1,
    reward: 3000,
    recommended: ['bunkerBuster', 'lgb', 'rocketPod'],
    setup(api) {
      api.objective('bunkers', 'Destroy the hardened bunkers', { kind: 'destroy', group: 'bunkers', count: 3 });
      api.objective('fuel', 'Destroy the fuel depots', { kind: 'destroy', group: 'fuel', count: 4 });
      api.ground('bunker', 3, { x: 0, z: 0, spread: 1500, objective: 'bunkers' });
      api.ground('fuelTank', 4, { x: 300, z: 300, spread: 1200, objective: 'fuel' });
      api.ground('aa', 8, { x: 0, z: 0, spread: 2500 });
      api.ground('sam', 2, { x: 0, z: 0, spread: 2500 });
      api.air('heli', 4, { x: 0, z: 0, alt: 150, spread: 2000 });
      api.waves([{ at: 60, spawn: (a) => a.air('fighter', 3, { x: -5000, z: -5000, alt: 2500, spread: 1000 }) }]);
    },
  },
  {
    id: 'm7',
    name: 'Rotor Hunt',
    type: 'Close air support',
    brief:
      'An armoured column is pushing through the frozen valley with gunships overhead. Destroy the helicopters and stop the tanks before they reach our lines.',
    env: { time: 'day', terrain: 'arctic', seed: 79, cloudiness: 1.2 },
    start: { x: 0, z: 9000, alt: 1500, yaw: 0 },
    wingmen: 1,
    reward: 3200,
    recommended: ['rocketPod', 'clusterBomb', 'cannon30'],
    setup(api) {
      api.objective('helis', 'Destroy the gunships', { kind: 'destroy', group: 'helis', count: 8 });
      api.objective('column', 'Stop the armoured column', { kind: 'destroy', group: 'column', count: 10 });
      api.convoy('tank', 10, { from: { x: -1500, z: -6000 }, to: { x: 500, z: 6000 }, objective: 'column' });
      api.air('heli', 5, { x: 0, z: -3000, alt: 150, spread: 2500, objective: 'helis' });
      api.ground('aa', 4, { x: 0, z: -2000, spread: 3000 });
      api.waves([{ at: 45, spawn: (a) => a.air('heli', 3, { x: 1000, z: 0, alt: 150, spread: 2000, objective: 'helis' }) }]);
    },
  },
  {
    id: 'm8',
    name: 'Red Squadron',
    type: 'Ace dogfight',
    brief:
      'The enemy has sent its best: the red-painted ace squadron and their stealth wingmen. They pop flares and break hard when you lock them. Use guns, swarm missiles and patience.',
    env: { time: 'dusk', terrain: 'mountains', seed: 83, cloudiness: 1 },
    start: { x: 0, z: 8000, alt: 2500, yaw: 0 },
    wingmen: 2,
    reward: 4000,
    recommended: ['swarmMissile', 'irMissile', 'railgun'],
    setup(api) {
      api.objective('aces', 'Shoot down the ace squadron', { kind: 'destroy', group: 'aces', count: 4 });
      api.air('ace', 4, { x: 0, z: -2000, alt: 2800, spread: 1500, objective: 'aces' });
      api.air('stealthFighter', 4, { x: 0, z: -3000, alt: 3000, spread: 2000 });
    },
  },
  {
    id: 'm9',
    name: 'Leviathan',
    type: 'Carrier strike',
    brief:
      'Their supercarrier is in range. It launches fighters every thirty seconds and its escorts carry SAMs. Strip the escorts, then sink the carrier. The cruise missile can thread through its defences.',
    env: { time: 'day', terrain: 'ocean', seed: 97, cloudiness: 0.9 },
    start: { x: 0, z: 10000, alt: 2200, yaw: 0 },
    wingmen: 2,
    reward: 5000,
    recommended: ['antiShipMissile', 'cruiseMissile', 'radarMissile'],
    setup(api) {
      api.objective('carrier', 'Sink the aircraft carrier', { kind: 'destroy', group: 'carrier', count: 1 });
      api.sea('carrier', 1, { x: 0, z: -3000, spread: 0, objective: 'carrier', patrol: 3000 });
      api.sea('destroyer', 2, { x: 0, z: -3000, spread: 1500, patrol: 3000 });
      api.sea('frigate', 2, { x: 0, z: -1500, spread: 2500, patrol: 2500 });
      api.air('fighter', 4, { x: 0, z: -2000, alt: 2000, spread: 2000 });
    },
  },
  {
    id: 'm10',
    name: 'Sky Fortress',
    type: 'Boss',
    brief:
      'The flying fortress is airborne: a 230-metre flying wing bristling with turrets. Its armour is impenetrable. Knock out the four engines to expose the reactor core, then destroy the core. Turrets and drone fighters will defend it.',
    env: { time: 'dusk', terrain: 'islands', seed: 101, cloudiness: 0.7 },
    start: { x: 0, z: 9000, alt: 2600, yaw: 0 },
    wingmen: 2,
    reward: 8000,
    recommended: ['radarMissile', 'swarmMissile', 'railgun'],
    setup(api) {
      api.boss({ x: 0, z: -1000, alt: 2600 });
      api.objective('boss', 'Destroy the Sky Fortress', { kind: 'boss' });
      api.air('attackDrone', 6, { x: 0, z: -1000, alt: 2600, spread: 1500 });
      api.waves([
        { at: 40, spawn: (a) => a.air('attackDrone', 6, { x: 0, z: -1000, alt: 2600, spread: 1500 }) },
        { at: 90, spawn: (a) => a.air('fighter', 4, { x: 0, z: -4000, alt: 2600, spread: 1500 }) },
        { at: 140, spawn: (a) => a.air('attackDrone', 8, { x: 0, z: -1000, alt: 2600, spread: 1500 }) },
      ]);
    },
  },
];
