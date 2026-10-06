// AI difficulty levels.
//   skill        0..1 general AI competence (aim, reactions, tactics)
//   damageTaken  multiplier on damage the player's team receives
//   aiGunDamage  multiplier on AI gun damage
//   flareChance  probability an AI pilot pops flares when a missile is inbound
//   lockTimeMult multiplier on how long AI needs to lock you
export const DIFFICULTY = {
  easy: { id: 'easy', label: 'Recruit', skill: 0.25, damageTaken: 0.5, aiGunDamage: 0.6, flareChance: 0.25, lockTimeMult: 1.8, reward: 0.8 },
  normal: { id: 'normal', label: 'Pilot', skill: 0.55, damageTaken: 0.85, aiGunDamage: 1, flareChance: 0.5, lockTimeMult: 1.2, reward: 1 },
  hard: { id: 'hard', label: 'Veteran', skill: 0.8, damageTaken: 1.15, aiGunDamage: 1.25, flareChance: 0.7, lockTimeMult: 1, reward: 1.3 },
  ace: { id: 'ace', label: 'Ace', skill: 1, damageTaken: 1.5, aiGunDamage: 1.5, flareChance: 0.9, lockTimeMult: 0.8, reward: 1.7 },
};
export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'ace'];
