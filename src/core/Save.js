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

export class Save {
  constructor() {
    const base = defaultSave();
    const loaded = read();
    this.data = loaded ? { ...base, ...loaded, campaign: { ...base.campaign, ...(loaded.campaign || {}) } } : base;
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
    const settings = this.data.settings;
    this.data = defaultSave();
    this.data.settings = settings;
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
