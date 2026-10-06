import { AIRCRAFT } from './aircraft.js';

// Unit types: stats, model, AI role and loadout.
// kind: air | ground | sea   role: AI behaviour
// skill is added to the difficulty skill (aces fly better than conscripts).

const fighterStats = (base, mult = {}) => ({ ...AIRCRAFT[base], ...mult });

export const UNITS = {
  // ── Aircraft ──
  fighter: {
    name: 'Fighter', kind: 'air', role: 'fighter', model: 'jet:viper', paint: 0x8a6a52,
    hp: 30, radius: 9, capsuleHalf: 7, score: 150, credits: 80,
    stats: fighterStats('viper', { maxSpeed: 300, pitchRate: 1.6, rollRate: 3.6, maxG: 8 }),
    loadout: { gun: 'enemyGun', s1: 'enemyIR', flares: 'flares' }, skill: 0,
  },
  interceptor: {
    name: 'Interceptor', kind: 'air', role: 'fighter', model: 'jet:lancer', paint: 0x6b7480,
    hp: 36, radius: 10, capsuleHalf: 8, score: 200, credits: 100,
    stats: fighterStats('lancer', { maxSpeed: 360, pitchRate: 1.3 }),
    loadout: { gun: 'enemyGun', s1: 'enemyRadar', flares: 'flares' }, skill: 0.05,
  },
  ace: {
    name: 'Ace', kind: 'air', role: 'fighter', model: 'jet:viper', paint: 0x7a1e1e,
    hp: 60, radius: 9, capsuleHalf: 7, score: 600, credits: 300,
    stats: fighterStats('viper', { maxSpeed: 340, pitchRate: 1.95, rollRate: 4.4, maxG: 9.5 }),
    loadout: { gun: 'enemyGun', s1: 'enemyIR', s2: 'enemyRadar', flares: 'flares' }, skill: 0.35,
  },
  stealthFighter: {
    name: 'Stealth Fighter', kind: 'air', role: 'fighter', model: 'jet:wraith', paint: 0x1c1e22,
    hp: 42, radius: 9, capsuleHalf: 7, score: 350, credits: 180, signature: 0.5,
    stats: fighterStats('wraith', { maxSpeed: 310 }),
    loadout: { gun: 'enemyGun', s1: 'enemyIR', flares: 'flares' }, skill: 0.15,
  },
  bomber: {
    name: 'Bomber', kind: 'air', role: 'bomber', model: 'bomber', paint: 0x8d8f8a,
    hp: 220, radius: 26, capsuleHalf: 18, score: 400, credits: 200, explosion: 30, noFall: false,
    stats: { ...AIRCRAFT.hammer, maxSpeed: 200, thrust: 22, abThrust: 0, pitchRate: 0.35, rollRate: 0.7, yawRate: 0.15, maxG: 2.5, stallSpeed: 55, cornerSpeed: 160, response: 2 },
    turrets: [[0, 3.5, -2], [0, -3, 6], [0, 2.5, 18]], turretGun: 'turretGun', skill: 0,
  },
  transport: {
    name: 'Transport', kind: 'air', role: 'bomber', model: 'transport', paint: 0xb9c0c6,
    hp: 160, radius: 20, capsuleHalf: 14, score: 0, credits: 0, explosion: 26,
    stats: { ...AIRCRAFT.hammer, maxSpeed: 180, thrust: 20, abThrust: 0, pitchRate: 0.35, rollRate: 0.7, yawRate: 0.15, maxG: 2.5, stallSpeed: 50, cornerSpeed: 150, response: 2 },
    skill: 0,
  },
  drone: {
    name: 'Target Drone', kind: 'air', role: 'drone', model: 'jet:drone', paint: 0xd25a1e,
    hp: 12, radius: 6, capsuleHalf: 4, score: 50, credits: 20,
    stats: fighterStats('viper', { maxSpeed: 220, thrust: 30, abThrust: 0, pitchRate: 1.0, rollRate: 2.5, maxG: 5 }),
    loadout: null, skill: 0,
  },
  attackDrone: {
    name: 'Attack Drone', kind: 'air', role: 'fighter', model: 'jet:drone', paint: 0x40444a,
    hp: 14, radius: 6, capsuleHalf: 4, score: 80, credits: 30,
    stats: fighterStats('viper', { maxSpeed: 290, pitchRate: 1.6, rollRate: 3.5, maxG: 9 }),
    loadout: { gun: 'enemyGun' }, skill: -0.1,
  },
  heli: {
    name: 'Attack Helicopter', kind: 'air', role: 'heli', model: 'heli', paint: 0x55604a,
    hp: 40, radius: 8, capsuleHalf: 5, score: 180, credits: 90, explosion: 14,
    loadout: { gun: 'heliGun', s1: 'heliRockets' }, skill: 0,
  },

  // ── Ground ──
  tank: { name: 'Tank', kind: 'ground', role: 'vehicle', model: 'tank', paint: 0x6b6a4a, hp: 50, radius: 5, score: 120, credits: 60, armored: true, speed: 6, explosion: 12 },
  truck: { name: 'Truck', kind: 'ground', role: 'vehicle', model: 'truck', paint: 0x5a5d48, hp: 20, radius: 4.5, score: 60, credits: 30, speed: 12, explosion: 9 },
  sam: { name: 'SAM Launcher', kind: 'ground', role: 'sam', model: 'sam', paint: 0x6f6d58, hp: 60, radius: 6, score: 250, credits: 120, missile: 'samMissile', range: 7000, reload: 7, explosion: 16, blastDamage: 10 },
  aa: { name: 'AA Gun', kind: 'ground', role: 'aa', model: 'aa', paint: 0x5f6050, hp: 45, radius: 5, score: 150, credits: 70, range: 2600, explosion: 11 },
  radar: { name: 'Radar Station', kind: 'ground', role: 'static', model: 'radar', paint: 0xc8ccc8, hp: 80, radius: 10, score: 200, credits: 100, explosion: 18 },
  bunker: { name: 'Bunker', kind: 'ground', role: 'static', model: 'bunker', paint: 0x8a8578, hp: 160, radius: 12, score: 300, credits: 150, armored: true, bunker: true, explosion: 22 },
  factory: { name: 'Factory', kind: 'ground', role: 'static', model: 'factory', paint: 0x8a7f74, hp: 260, radius: 22, score: 400, credits: 200, explosion: 40 },
  fuelTank: { name: 'Fuel Depot', kind: 'ground', role: 'static', model: 'fuelTank', paint: 0xb0b2a8, hp: 60, radius: 9, score: 150, credits: 60, explosion: 34, blastDamage: 60, blastRadius: 60 },
  building: { name: 'Building', kind: 'ground', role: 'static', model: 'building', paint: 0x9b958a, hp: 120, radius: 14, score: 0, credits: 0, isTarget: false, explosion: 26 },

  // ── Ships ──
  frigate: { name: 'Frigate', kind: 'sea', role: 'ship', model: 'frigate', paint: 0xa7adb3, hp: 300, radius: 40, score: 600, credits: 300, armored: true, speed: 9, missile: 'samMissile', range: 6500, reload: 9, aaGuns: [[0, 14, -10]], explosion: 45 },
  destroyer: { name: 'Destroyer', kind: 'sea', role: 'ship', model: 'destroyer', paint: 0x8f979f, hp: 480, radius: 55, score: 900, credits: 450, armored: true, speed: 8, missile: 'samMissile', range: 8000, reload: 6, aaGuns: [[0, 12, -38], [0, 20, 2]], explosion: 60 },
  carrier: { name: 'Carrier', kind: 'sea', role: 'carrier', model: 'carrier', paint: 0x80888f, hp: 1600, radius: 150, score: 3000, credits: 1500, armored: true, speed: 6, aaGuns: [[-30, 15, -120], [30, 15, -120], [-30, 15, 120], [30, 15, 120], [26, 40, 30]], explosion: 120, launches: 'fighter', launchEvery: 30 },

  // ── Boss: the flying fortress ──
  fortress: { name: 'Sky Fortress', kind: 'air', role: 'boss', model: 'fortress', paint: 0x55595f, hp: 1, radius: 130, score: 10000, credits: 4000, invulnerable: true, explosion: 160, isTarget: true },
  fortressEngine: { name: 'Fortress Engine', kind: 'part', role: 'part', model: 'fortressEngine', paint: 0x55595f, hp: 260, radius: 10, score: 800, credits: 300, explosion: 30 },
  fortressTurret: { name: 'Fortress Turret', kind: 'part', role: 'aa', model: 'turret', paint: 0x55595f, hp: 90, radius: 5, score: 250, credits: 80, range: 3000, explosion: 12 },
  fortressCore: { name: 'Reactor Core', kind: 'part', role: 'part', model: 'fortressCore', paint: 0xffffff, hp: 900, radius: 8, score: 5000, credits: 2000, explosion: 70 },
  bomberTurret: { name: 'Gunner', kind: 'part', role: 'aa', model: null, hp: 9999, radius: 2, isTarget: false, ghost: true, tracerOnly: true, range: 1600, score: 0, credits: 0 },
};
