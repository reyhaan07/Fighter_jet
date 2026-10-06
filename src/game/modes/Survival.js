import * as THREE from 'three';
import { TEAM } from '../../entities/Unit.js';

// Survival: endless waves that grow in size and skill. Fighters first, then
// interceptors, helicopters, bombers, air defences, aces and stealth jets.
// Between waves the jet is partly repaired and rearmed. Scores go to the
// local leaderboard (localStorage).

const _v = new THREE.Vector3();

export class Survival {
  constructor(s, mission) {
    this.s = s;
    this.m = mission;
    this.wave = 0;
    this.state = 'intro';
    this.timer = 4;
    this.waveStart = 0;
    this.center = new THREE.Vector3(0, 1500, 0);
    this.waypoint = null;
    this.over = false;
  }

  setup() {
    this.s.spawnWingmen(this.m.wingmen ?? 1);
    this.s.hud?.message('SURVIVAL', 3);
    this.s.hud?.message('Survive as many waves as you can', 4, '#7fd4ff');
  }

  composition(n) {
    // Returns [unitType, count] pairs for wave n (1-based).
    const c = [['fighter', Math.min(14, 2 + Math.floor(n * 1.2))]];
    if (n >= 2) c.push(['heli', Math.min(6, Math.floor(n / 2))]);
    if (n >= 3) c.push(['interceptor', Math.min(8, Math.floor((n - 1) / 2))]);
    if (n >= 3) c.push(['attackDrone', Math.min(12, n)]);
    if (n % 3 === 0) c.push(['bomber', Math.min(5, 1 + Math.floor(n / 3))]);
    if (n >= 4) c.push(['aa', Math.min(8, n - 2)]);
    if (n >= 5) c.push(['sam', Math.min(6, Math.floor((n - 3) / 2))]);
    if (n >= 6) c.push(['ace', Math.min(4, Math.floor((n - 4) / 2))]);
    if (n >= 8) c.push(['stealthFighter', Math.min(6, n - 7)]);
    if (n >= 5) c.push(['tank', 4]);
    return c;
  }

  startWave() {
    const s = this.s;
    this.wave++;
    this.waveStart = s.time;
    const p = s.player;
    const skillBonus = Math.min(0.4, this.wave * 0.03);
    // Spawn ahead-ish of the player, at a distance.
    const heading = Math.atan2(p.forward.x, -p.forward.z);
    for (const [type, count] of this.composition(this.wave)) {
      for (let i = 0; i < count; i++) {
        const a = heading + (Math.random() - 0.5) * 2.2;
        const r = 6000 + Math.random() * 3000;
        _v.set(p.pos.x + Math.sin(a) * r, 0, p.pos.z - Math.cos(a) * r);
        _v.x = Math.max(-11000, Math.min(11000, _v.x));
        _v.z = Math.max(-11000, Math.min(11000, _v.z));
        const ground = s.world.surfaceAt(_v.x, _v.z);
        if (type === 'aa' || type === 'sam' || type === 'tank') {
          const land = s.world.terrain.findLand(p.pos.x * 0.5 + _v.x * 0.5, p.pos.z * 0.5 + _v.z * 0.5, 4000);
          if (land) s.entities.spawnGround(type, TEAM.ENEMY, land.x, land.z, Math.random() * 6.28, {});
          continue;
        }
        _v.y = Math.max(ground + 600, 1200 + Math.random() * 1500);
        if (type === 'heli') _v.y = ground + 150;
        const yaw = Math.atan2(_v.x - p.pos.x, _v.z - p.pos.z);
        const opts = { skill: skillBonus };
        if (type === 'bomber') opts.waypoint = _v.clone().set(p.pos.x, _v.y, p.pos.z);
        s.entities.spawnAir(type, TEAM.ENEMY, _v.x, _v.y, _v.z, yaw, opts);
      }
    }
    s.hud?.message(`WAVE ${this.wave}`, 3, '#ffcf5a');
    s.radio('AWACS', this.wave === 1 ? 'Bandits inbound. Weapons free.' : `Wave ${this.wave} inbound. Multiple contacts.`);
    this.state = 'fight';
  }

  step(dt) {
    const s = this.s;
    if (this.over) return;
    if (this.state === 'intro' || this.state === 'break') {
      this.timer -= dt;
      if (this.timer <= 0) this.startWave();
      return;
    }
    // Bombers head for the player's area.
    for (const u of s.entities.air) {
      if (u.role === 'bomber' && u.alive && u.controller?.waypoint) u.controller.waypoint.set(s.player.pos.x, u.pos.y, s.player.pos.z);
    }
    let air = 0;
    for (const u of s.entities.units) if (u.alive && u.team === TEAM.ENEMY && u.isTarget && (u.isAir || u.def.role === 'sam' || u.def.role === 'aa')) air++;
    this.remaining = air;
    if (air === 0 && s.time - this.waveStart > 3) {
      const bonus = this.wave * 250;
      s.score += bonus;
      s.creditsEarned += this.wave * 60;
      s.hud?.message(`WAVE ${this.wave} CLEARED  +${bonus}`, 3, '#8dffb5');
      // Repair and rearm between waves.
      const p = s.player;
      p.hp = Math.min(p.maxHp, p.hp + p.maxHp * 0.35);
      for (const w of p.loadout.all) w.ammo = Math.min(w.maxAmmo, w.ammo + Math.ceil(w.maxAmmo * 0.5));
      for (const w of s.wingmen) if (w.alive) w.hp = w.maxHp;
      // Clean up leftover ground units so waves don't pile up.
      for (const u of [...s.entities.ground]) if (u.team === TEAM.ENEMY && !u.parent) s.entities.remove(u);
      this.state = 'break';
      this.timer = 6;
    }
  }

  hudLines(s) {
    const lines = [`WAVE ${this.wave}`, `SCORE ${s.score}`];
    if (this.state === 'fight') lines.push(`HOSTILES ${this.remaining ?? 0}`);
    else if (this.state === 'break') lines.push(`NEXT WAVE IN ${Math.ceil(this.timer)}`);
    return lines;
  }

  onPlayerDown() {
    if (this.over) return;
    this.over = true;
    const s = this.s;
    setTimeout(() => {
      s.game.finishSession({
        mode: 'survival',
        success: false,
        title: 'SHOT DOWN',
        subtitle: `You survived ${Math.max(0, this.wave - 1)} wave${this.wave === 2 ? '' : 's'}`,
        score: s.score,
        wave: this.wave,
        credits: s.creditsEarned,
        kills: s.kills,
        stats: s.stats,
      });
    }, 3500);
  }
}
