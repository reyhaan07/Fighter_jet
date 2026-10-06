import { rng } from '../core/math.js';

// Daily rewards: a 7-day login streak (miss a day and it starts over) and three
// daily tasks that refresh at local midnight. Tasks are picked from the date,
// so everyone gets the same three each day. All state lives in the save file.

export const LOGIN_REWARDS = [500, 750, 1000, 1500, 2000, 3000, 6000];

const TASKS = [
  { id: 'killAir', text: 'Shoot down {n} aircraft', n: [12, 20, 30], reward: [900, 1400, 2000] },
  { id: 'killGround', text: 'Destroy {n} ground targets', n: [8, 15, 25], reward: [900, 1400, 2000] },
  { id: 'killSea', text: 'Sink {n} ships', n: [2, 4, 6], reward: [1000, 1600, 2400] },
  { id: 'gunKills', text: 'Get {n} kills with your gun', n: [5, 10, 15], reward: [1000, 1500, 2200] },
  { id: 'missiles', text: 'Fire {n} missiles', n: [15, 30, 50], reward: [700, 1100, 1600] },
  { id: 'wins', text: 'Complete {n} campaign levels', n: [1, 2, 3], reward: [1200, 2000, 3000] },
  { id: 'winHard', text: 'Complete a level on Veteran or Ace', n: [1, 1, 2], reward: [2000, 2000, 3500] },
  { id: 'waves', text: 'Reach wave {n} in Survival', n: [4, 6, 8], reward: [1000, 1600, 2400], max: true },
  { id: 'bossKill', text: 'Destroy a Sky Fortress or carrier', n: [1, 1, 1], reward: [2500, 2500, 2500] },
];

export function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dayDiff(a, b) {
  return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
}

export class Daily {
  constructor(save) {
    this.save = save;
    this.refresh();
  }

  /** Always the live save object (reset / import replace save.data). */
  get d() {
    return (this.save.data.daily ||= { lastLogin: null, streak: 0, claimedLogin: null, date: null, tasks: [] });
  }

  /** Roll over to a new day: new tasks, streak continues or resets. */
  refresh() {
    const d = this.d;
    const t = today();
    if (d.date !== t) {
      d.date = t;
      const r = rng(Number(t.replace(/-/g, '')));
      const pool = [...TASKS];
      d.tasks = [];
      for (let i = 0; i < 3; i++) {
        const k = Math.floor(r() * pool.length);
        const def = pool.splice(k, 1)[0];
        const tier = i; // one easy, one medium, one hard
        d.tasks.push({ id: def.id, text: def.text.replace('{n}', def.n[tier]), target: def.n[tier], reward: def.reward[tier], progress: 0, claimed: false, max: !!def.max });
      }
    }
    if (d.lastLogin !== t) {
      const gap = d.lastLogin ? dayDiff(d.lastLogin, t) : 99;
      d.streak = gap === 1 ? (d.streak % 7) + 1 : 1;
      d.lastLogin = t;
    }
    this.save.write();
  }

  get loginAvailable() {
    return this.d.claimedLogin !== today();
  }

  get loginReward() {
    return LOGIN_REWARDS[(this.d.streak - 1) % 7];
  }

  claimLogin() {
    this.refresh();
    if (!this.loginAvailable) return 0;
    const amount = this.loginReward;
    this.d.claimedLogin = today();
    this.save.data.credits += amount;
    this.save.write();
    return amount;
  }

  /** Progress a task type by n (or set a max for "reach" tasks). */
  track(id, n = 1) {
    this.refresh();
    let changed = false;
    for (const t of this.d.tasks) {
      if (t.id !== id || t.claimed) continue;
      const before = t.progress;
      t.progress = t.max ? Math.max(t.progress, n) : Math.min(t.target, t.progress + n);
      t.progress = Math.min(t.target, t.progress);
      if (t.progress !== before) changed = true;
      if (before < t.target && t.progress >= t.target) this.onComplete?.(t);
    }
    if (changed) this.save.write();
  }

  claimTask(i) {
    const t = this.d.tasks[i];
    if (!t || t.claimed || t.progress < t.target) return 0;
    t.claimed = true;
    this.save.data.credits += t.reward;
    this.save.write();
    return t.reward;
  }

  get claimable() {
    return (this.loginAvailable ? 1 : 0) + this.d.tasks.filter((t) => !t.claimed && t.progress >= t.target).length;
  }
}
