// Persistent progress, settings and leaderboard in localStorage.
// Every access is guarded: private windows or blocked storage just mean
// nothing is remembered between sessions.

const KEY = 'fighterjet.save.v1';

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function defaultSave() {
  return {
    credits: 1500,
    campaign: { unlocked: 1, completed: {}, bestScores: {} },
    unlockedWeapons: ['cannon20', 'irMissile', 'rocketPod', 'flares', 'chaff'],
    unlockedAircraft: ['viper'],
    upgrades: {}, // weaponId -> { damage, reload, lock }
    loadout: {
      aircraft: 'viper',
      paint: 'gunmetal',
      slots: { gun: 'cannon20', s1: 'irMissile', s2: 'rocketPod', s3: 'irMissile', def: 'chaff' },
    },
    leaderboard: [], // { name, score, wave, date }
    settings: null, // filled by Settings
  };
}

/** Fill in anything missing from an older (or imported) save and migrate it. */
export function normalizeSave(loaded) {
  const base = defaultSave();
  if (!loaded || typeof loaded !== 'object') return base;
  const lo = loaded.loadout || {};
  const d = {
    ...base,
    ...loaded,
    campaign: { ...base.campaign, ...(loaded.campaign || {}) },
    loadout: { ...base.loadout, ...lo, slots: { ...base.loadout.slots, ...(lo.slots || {}) } },
  };
  const c = d.campaign;
  c.completed ||= {};
  c.bestScores ||= {};
  for (const k of ['unlockedWeapons', 'unlockedAircraft', 'leaderboard']) if (!Array.isArray(d[k])) d[k] = base[k];
  if (!d.unlockedAircraft.includes('viper')) d.unlockedAircraft.unshift('viper');
  if (!d.upgrades || typeof d.upgrades !== 'object') d.upgrades = {};
  if (typeof d.credits !== 'number' || !isFinite(d.credits)) d.credits = base.credits;
  // The first release had 10 missions: beating m10 should open level 11.
  if (c.completed.m10 && c.unlocked < 11) c.unlocked = 11;
  return d;
}

export class Save {
  constructor() {
    this.data = normalizeSave(read());
  }

  write() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
      return true;
    } catch {
      return false;
    }
  }

  reset() {
    const { settings, daily } = this.data;
    this.data = defaultSave();
    this.data.settings = settings;
    if (daily) this.data.daily = daily; // the login streak is not progress
    this.write();
  }

  addScore(entry) {
    const lb = this.data.leaderboard;
    lb.push(entry);
    lb.sort((a, b) => b.score - a.score);
    lb.length = Math.min(lb.length, 10);
    this.write();
    return lb.indexOf(entry);
  }
}
