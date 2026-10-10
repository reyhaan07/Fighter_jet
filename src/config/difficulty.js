// AI difficulty levels.
//   skill        0..1 general AI competence (aim, reactions, tactics)
//   damageTaken  multiplier on damage the player's team receives
//   aiGunDamage  multiplier on AI gun damage
//   flareChance  probability an AI pilot pops flares when a missile is inbound
//   lockTimeMult multiplier on how long AI needs to lock you
//   levelSkill   how much of the later levels' extra enemy skill applies
//   missileRate  chance an AI pilot actually fires when it has a missile shot
//   enemyHp      multiplier on enemy toughness
//   info         plain-language description shown in the menus
export const DIFFICULTY = {
  easy: {
    id: 'easy', label: 'Recruit', skill: 0.05, damageTaken: 0.35, aiGunDamage: 0.4, flareChance: 0.15, lockTimeMult: 2.6, levelSkill: 0.25, missileRate: 0.3, enemyHp: 0.7, reward: 0.8,
    info: 'Relaxed. Enemies are slow to aim, rarely fire missiles and go down quickly. You take about a third of the damage.',
  },
  normal: {
    id: 'normal', label: 'Pilot', skill: 0.35, damageTaken: 0.65, aiGunDamage: 0.75, flareChance: 0.4, lockTimeMult: 1.6, levelSkill: 0.6, missileRate: 0.6, enemyHp: 0.9, reward: 1,
    info: 'Balanced. Enemies fight back but give you time to react.',
  },
  hard: {
    id: 'hard', label: 'Veteran', skill: 0.7, damageTaken: 1, aiGunDamage: 1.1, flareChance: 0.65, lockTimeMult: 1.1, levelSkill: 1, missileRate: 1, enemyHp: 1, reward: 1.3,
    info: 'Tough. Enemies aim well, dodge your missiles and use flares. 30 % more credits.',
  },
  ace: {
    id: 'ace', label: 'Ace', skill: 0.95, damageTaken: 1.4, aiGunDamage: 1.4, flareChance: 0.9, lockTimeMult: 0.8, levelSkill: 1.2, missileRate: 1, enemyHp: 1.15, reward: 1.7,
    info: 'Brutal. The best enemy pilots, tougher jets, little room for mistakes. 70 % more credits.',
  },
};
export const DIFFICULTY_ORDER = ['easy', 'normal', 'hard', 'ace'];
