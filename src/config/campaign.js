import { MISSIONS } from './missions.js';
import { rng } from '../core/math.js';

// The 100-level campaign: 10 chapters of 10 levels.
// Chapter 1 is the hand-made story (config/missions.js). Chapters 2–10 are
// generated deterministically from mission templates: each level gets its own
// map seed, terrain, time of day, weather, objectives and enemy mix, and the
// difficulty climbs steadily. Every chapter ends with a big "boss" level.

export const CHAPTERS = [
  { name: 'The Northern Isles', terrain: ['islands'], times: ['dusk', 'day'] },
  { name: 'Coastal Front', terrain: ['coast'], times: ['day', 'dusk'] },
  { name: 'Sands of Kharan', terrain: ['desert'], times: ['day', 'dusk', 'day'] },
  { name: 'Frozen Reach', terrain: ['arctic'], times: ['day', 'dusk'] },
  { name: 'Emerald Archipelago', terrain: ['islands', 'ocean'], times: ['day', 'dusk'] },
  { name: 'High Sierra', terrain: ['mountains'], times: ['day', 'dusk', 'night'] },
  { name: 'The Endless Sea', terrain: ['ocean', 'coast'], times: ['day', 'dusk'] },
  { name: 'Night of Iron', terrain: ['mountains', 'coast', 'desert'], times: ['night'] },
  { name: 'Iron Curtain', terrain: ['coast', 'mountains', 'arctic'], times: ['dusk', 'day', 'night'] },
  { name: 'The Last Sky', terrain: ['islands', 'mountains', 'ocean'], times: ['dusk', 'night', 'day'] },
];

const NAMES = {
  islands: [['Gull', 'Coral', 'Driftwood', 'Lantern', 'Salt', 'Seal'], ['Point', 'Cove', 'Reef', 'Strait', 'Haven', 'Shoals']],
  coast: [['Harbour', 'Cliff', 'Lighthouse', 'Breakwater', 'Tide', 'Storm'], ['Road', 'Watch', 'Gate', 'Bay', 'Line', 'Front']],
  desert: [['Amber', 'Dune', 'Scorpion', 'Mirage', 'Sun', 'Red'], ['Sea', 'Canyon', 'Pass', 'Oasis', 'Mesa', 'Wells']],
  arctic: [['Frost', 'Glacier', 'White', 'Polar', 'Ice', 'Aurora'], ['Fjord', 'Shelf', 'Ridge', 'Fields', 'Hollow', 'Spine']],
  ocean: [['Deep', 'Blue', 'Leviathan', 'Trident', 'Siren', 'Abyss'], ['Water', 'Current', 'Expanse', 'Gulf', 'Trench', 'Horizon']],
  mountains: [['Eagle', 'Granite', 'Thunder', 'Wolf', 'Iron', 'Pine'], ['Peak', 'Pass', 'Valley', 'Crown', 'Gorge', 'Forest Path']],
};

const TYPES = [
  // [template, label, weight, minLevel]
  ['air', 'Air superiority', 3, 0],
  ['strike', 'Ground strike', 3, 0],
  ['escort', 'Escort', 1.5, 12],
  ['intercept', 'Bomber intercept', 1.5, 14],
  ['naval', 'Anti-ship', 2, 13],
  ['cas', 'Close air support', 2, 15],
  ['aces', 'Ace dogfight', 1.2, 25],
];

/** Icon shown on the world map for each template. */
export const ICONS = { air: 'air', strike: 'strike', escort: 'escort', intercept: 'air', naval: 'naval', cas: 'strike', aces: 'aces', carrier: 'naval', boss: 'boss', story: 'air' };

function pick(r, list) {
  return list[Math.floor(r() * list.length) % list.length];
}

function pickType(r, n, terrain) {
  const pool = TYPES.filter(([t, , , min]) => n >= min && !((t === 'naval' || t === 'escort') && terrain === 'desert'));
  let total = 0;
  for (const p of pool) total += p[2] * (terrain === 'ocean' && p[0] === 'naval' ? 3 : 1);
  let x = r() * total;
  for (const p of pool) {
    x -= p[2] * (terrain === 'ocean' && p[0] === 'naval' ? 3 : 1);
    if (x <= 0) return p;
  }
  return pool[0];
}

/** Enemy fighter type for this difficulty. */
function fighterMix(d, r) {
  const x = r();
  if (d > 0.75 && x < 0.25) return 'ace';
  if (d > 0.5 && x < 0.35) return 'stealthFighter';
  if (d > 0.2 && x < 0.55) return 'interceptor';
  return 'fighter';
}

function generate(n) {
  const chapter = Math.floor((n - 1) / 10);
  const C = CHAPTERS[chapter];
  const r = rng(n * 7919 + 13);
  const d = (n - 11) / 89; // 0 → 1 over levels 11..100
  const terrain = pick(r, C.terrain);
  const time = pick(r, C.times);
  const seed = 1000 + n * 37;
  const isBoss = n % 10 === 0;
  const words = NAMES[terrain];
  const noun = pick(r, words[1]);
  const name = n === 100 ? 'The Last Sky' : noun === 'Forest Path' ? 'Forest Path' : `${pick(r, words[0])} ${noun}`;
  const env = { time, terrain, seed, cloudiness: 0.5 + r() * 1.1, cloudBase: 1400 + r() * 1200 };
  const skill = d * 0.35;
  const count = (base, per) => Math.round(base + per * d * 10);
  const start = { x: 0, z: 9000, alt: 1800 + Math.round(r() * 800), yaw: 0 };
  let template;
  let type;
  if (isBoss) {
    template = n === 100 || n % 20 === 0 ? 'boss' : terrain === 'ocean' || terrain === 'islands' || terrain === 'coast' ? 'carrier' : 'aces';
    type = template === 'boss' ? 'Boss' : template === 'carrier' ? 'Carrier strike' : 'Ace squadron';
  } else {
    const t = pickType(r, n, terrain);
    template = t[0];
    type = t[1];
  }
  if (template === 'naval' && terrain === 'desert') template = 'strike';

  const brief = BRIEFS[template](name, C.name, n);
  const setup = (api) => {
    const R = rng(n * 104729 + 7);
    const fighter = () => fighterMix(d, R);
    const cap = (k) => {
      for (let i = 0; i < k; i++) api.air(fighter(), 1, { x: (R() - 0.5) * 6000, z: (R() - 0.5) * 6000 - 1000, alt: 2000 + R() * 1200, spread: 600, skill });
    };
    switch (template) {
      case 'air': {
        const a = count(4, 0.6);
        const b = count(3, 0.5);
        api.objective('bandits', 'Destroy enemy aircraft', { kind: 'destroy', group: 'bandits', count: a + b });
        for (let i = 0; i < a; i++) api.air(fighter(), 1, { x: (R() - 0.5) * 3000, z: -500 + (R() - 0.5) * 3000, alt: 2200, spread: 500, objective: 'bandits', skill });
        api.waves([{ at: 'cleared', spawn: (x) => { for (let i = 0; i < b; i++) x.air(fighter(), 1, { x: (R() - 0.5) * 4000, z: -4000, alt: 2600, spread: 800, objective: 'bandits', skill }); } }]);
        if (d > 0.4) api.ground('sam', count(0, 0.25), { x: 0, z: -2000, spread: 4000 });
        break;
      }
      case 'strike': {
        const sams = count(2, 0.3);
        const aux = R() < 0.5 ? 'fuelTank' : 'radar';
        api.objective('sites', 'Destroy the SAM sites', { kind: 'destroy', group: 'sites', count: sams });
        api.objective('aux', aux === 'radar' ? 'Destroy the radar stations' : 'Destroy the fuel depots', { kind: 'destroy', group: 'aux', count: 2 });
        api.ground('sam', sams, { x: 0, z: 0, spread: 2800, objective: 'sites' });
        api.ground(aux, 2, { x: 300, z: 200, spread: 1200, objective: 'aux' });
        api.ground('aa', count(4, 0.6), { x: 0, z: 0, spread: 2600 });
        api.ground('tank', count(4, 0.4), { x: 0, z: 500, spread: 2000 });
        if (d > 0.3) api.ground('bunker', count(0, 0.2), { x: 0, z: 0, spread: 1500 });
        cap(count(1, 0.3));
        break;
      }
      case 'escort': {
        api.friendly('transport', 3, { x: -9000, z: 6000, alt: 1900, to: { x: 9000, z: -4000 }, objective: 'convoy' });
        api.objective('convoy', 'Protect the transports (lose at most 1)', { kind: 'protect', group: 'convoy', failIfLost: 1 });
        api.objective('arrive', 'Escort the transports to safety', { kind: 'escort', group: 'convoy', zone: { x: 9000, z: -4000, r: 1500 } });
        const w = count(2, 0.35);
        api.waves([0, 1, 2].map((k) => ({ at: 15 + k * 40, spawn: (x) => { for (let i = 0; i < w; i++) x.air(fighter(), 1, { x: -2000 + k * 4000, z: -3000 + k * 2000, alt: 2400, spread: 1500, skill }); } })));
        break;
      }
      case 'intercept': {
        const b = count(4, 0.4);
        api.objective('bombers', 'Stop every bomber before it reaches the city', { kind: 'intercept', group: 'bombers', zone: { x: 0, z: 10500, r: 2500 } });
        api.air('bomber', b, { x: 0, z: -9000, alt: 2600, spread: 1000, objective: 'bombers', waypoint: { x: 0, y: 2600, z: 10500 }, skill });
        cap(count(2, 0.4));
        break;
      }
      case 'naval': {
        const f = count(2, 0.2);
        const k = count(0, 0.15) + 1;
        api.objective('fleet', 'Sink the enemy fleet', { kind: 'destroy', group: 'fleet', count: f + k });
        api.sea('frigate', f, { x: 0, z: -2000, spread: 3000, objective: 'fleet', patrol: 2500 });
        api.sea('destroyer', k, { x: 500, z: -3000, spread: 1500, objective: 'fleet', patrol: 2000 });
        cap(count(2, 0.3));
        break;
      }
      case 'cas': {
        const h = count(3, 0.4);
        const t = count(6, 0.5);
        api.objective('helis', 'Destroy the gunships', { kind: 'destroy', group: 'helis', count: h });
        api.objective('column', 'Stop the armoured column', { kind: 'destroy', group: 'column', count: t });
        api.convoy('tank', t, { from: { x: -1500, z: -6000 }, to: { x: 500, z: 6000 }, objective: 'column' });
        api.air('heli', h, { x: 0, z: -3000, alt: 150, spread: 2500, objective: 'helis', skill });
        api.ground('aa', count(2, 0.4), { x: 0, z: -2000, spread: 3000 });
        break;
      }
      case 'aces': {
        const a = count(3, 0.3);
        api.objective('aces', 'Shoot down the ace squadron', { kind: 'destroy', group: 'aces', count: a });
        api.air('ace', a, { x: 0, z: -2000, alt: 2800, spread: 1500, objective: 'aces', skill: skill + 0.1 });
        api.air('stealthFighter', count(2, 0.3), { x: 0, z: -3000, alt: 3000, spread: 2000, skill });
        break;
      }
      case 'carrier': {
        api.objective('carrier', 'Sink the aircraft carrier', { kind: 'destroy', group: 'carrier', count: 1 });
        api.sea('carrier', 1, { x: 0, z: -3000, spread: 0, objective: 'carrier', patrol: 3000 });
        api.sea('destroyer', count(1, 0.15), { x: 0, z: -3000, spread: 1500, patrol: 3000 });
        api.sea('frigate', count(2, 0.15), { x: 0, z: -1500, spread: 2500, patrol: 2500 });
        cap(count(3, 0.3));
        break;
      }
      case 'boss': {
        api.boss({ x: 0, z: -1000, alt: 2600, hpMult: 1 + d * 1.5 });
        api.objective('boss', 'Destroy the Sky Fortress', { kind: 'boss' });
        api.air('attackDrone', count(6, 0.4), { x: 0, z: -1000, alt: 2600, spread: 1500, skill });
        api.waves([1, 2, 3].map((k) => ({ at: 30 + k * 45, spawn: (x) => x.air(k === 2 ? fighter() : 'attackDrone', count(5, 0.4), { x: 0, z: -2000, alt: 2600, spread: 1500, skill }) })));
        break;
      }
    }
  };
  return {
    id: `L${n}`,
    level: n,
    chapter,
    name,
    type,
    icon: ICONS[template],
    boss: isBoss,
    brief,
    env,
    start,
    wingmen: d > 0.5 ? 2 : 1,
    reward: Math.round(1200 + n * 90 + (isBoss ? 2500 : 0)),
    recommended: RECOMMENDED[template],
    setup,
  };
}

const RECOMMENDED = {
  air: ['irMissile', 'radarMissile'],
  strike: ['lgb', 'clusterBomb', 'rocketPod'],
  escort: ['radarMissile', 'irMissile'],
  intercept: ['radarMissile', 'swarmMissile'],
  naval: ['antiShipMissile', 'lgb'],
  cas: ['rocketPod', 'clusterBomb', 'cannon30'],
  aces: ['swarmMissile', 'irMissile', 'railgun'],
  carrier: ['antiShipMissile', 'cruiseMissile'],
  boss: ['radarMissile', 'swarmMissile', 'railgun'],
};

const BRIEFS = {
  air: (n, c) => `Enemy fighters are contesting the skies over ${n}. Clear the air so the ${c} campaign can push on. Expect a second wave once the first is down.`,
  strike: (n) => `A SAM network is shielding ${n}. Destroy the launchers and the support targets around them. AA guns and armour defend the site.`,
  escort: (n) => `Transports must get through ${n}. Interceptors will come in waves; keep at least two transports alive until they reach safety.`,
  intercept: (n) => `A bomber stream is heading through ${n} for the city behind you. Not one bomber may get through.`,
  naval: (n) => `An enemy surface group is operating near ${n}. Sink every ship. Their SAMs are radar-guided: use chaff and ECM.`,
  cas: (n) => `An armoured column is rolling through ${n} under gunship cover. Stop the tanks and shoot down the helicopters.`,
  aces: (n) => `The enemy's best pilots are waiting over ${n}. They break hard and pop flares. Stay patient.`,
  carrier: (n) => `A carrier group has moved into ${n} and keeps launching fighters. Strip its escorts and sink the carrier.`,
  boss: (n, c, lvl) => `The flying fortress${lvl === 100 ? "'s final and strongest version" : ''} is over ${n}. Knock out its four engines to expose the reactor core, then destroy it.`,
};

/** All 100 levels. Chapter 1 = the story missions. */
export const LEVELS = [];
MISSIONS.forEach((m, i) => LEVELS.push({ ...m, level: i + 1, chapter: 0, icon: m.id === 'm10' ? 'boss' : ICONS[{ m1: 'air', m2: 'strike', m3: 'escort', m4: 'intercept', m5: 'naval', m6: 'strike', m7: 'cas', m8: 'aces', m9: 'carrier' }[m.id]] || 'air', boss: i === 9 }));
for (let n = 11; n <= 100; n++) LEVELS.push(generate(n));

export function levelById(id) {
  return LEVELS.find((l) => l.id === id);
}
