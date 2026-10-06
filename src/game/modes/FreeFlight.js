import { IS_TOUCH } from '../../core/Platform.js';
import * as THREE from 'three';
import { TEAM } from '../../entities/Unit.js';

// Free flight / training range: target drones that respawn, unlimited ammo
// option, and a stress-test switch (50+ enemies, 500+ projectiles).

const _v = new THREE.Vector3();

export class FreeFlight {
  constructor(s, mission) {
    this.s = s;
    this.m = mission;
    this.respawn = 0;
    this.stress = !!mission.stress;
    this.duel = !!mission.duel;
    this.center = new THREE.Vector3(0, 1400, -2000);
    this.waypoint = null;
  }

  setup() {
    const s = this.s;
    if (this.duel) {
      const p = s.player.pos;
      s.entities.spawnAir('fighter', TEAM.ENEMY, p.x + 300, p.y + 100, p.z - 2200, Math.PI, {});
      s.hud?.message('DUEL: SHOOT DOWN THE BANDIT', 4);
      return;
    }
    if (this.stress) {
      this.spawnStress();
      return;
    }
    for (let i = 0; i < 8; i++) this.spawnDrone();
    for (let i = 0; i < 6; i++) {
      const p = s.world.terrain.findLand(this.center.x, this.center.z, 5000);
      if (p) s.entities.spawnGround(i % 2 ? 'truck' : 'tank', TEAM.ENEMY, p.x, p.z, Math.random() * 6, {});
    }
    s.spawnWingmen(this.m.wingmen ?? 1);
    s.hud?.message('TRAINING RANGE — FREE FLIGHT', 4);
    s.hud?.message(`Drones and vehicles respawn. ${IS_TOUCH ? 'Tap II' : 'Press Esc'} for the menu.`, 5, '#7fd4ff');
  }

  spawnDrone() {
    const s = this.s;
    const a = Math.random() * Math.PI * 2;
    const r = 1500 + Math.random() * 4000;
    _v.set(this.center.x + Math.cos(a) * r, this.center.y + Math.random() * 1200, this.center.z + Math.sin(a) * r);
    const ground = s.world.surfaceAt(_v.x, _v.z);
    _v.y = Math.max(_v.y, ground + 500);
    s.entities.spawnAir('drone', TEAM.ENEMY, _v.x, _v.y, _v.z, Math.random() * 6.28, { waypoint: _v });
  }

  spawnStress() {
    const s = this.s;
    const types = ['fighter', 'fighter', 'interceptor', 'attackDrone', 'fighter'];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const r = 1800 + (i % 5) * 600;
      s.entities.spawnAir(types[i % types.length], TEAM.ENEMY, Math.cos(a) * r, 1300 + (i % 7) * 120, -1500 + Math.sin(a) * r, a + Math.PI / 2, {});
    }
    s.spawnWingmen(2);
    for (let i = 0; i < 12; i++) {
      const p = s.world.terrain.findLand(0, -3000, 6000);
      if (p) s.entities.spawnGround(i % 3 === 0 ? 'aa' : 'tank', TEAM.ENEMY, p.x, p.z, 0, {});
    }
    s.player.loadout.refill();
    s.hud?.message('STRESS TEST: 60 AIRCRAFT', 4);
  }

  step(dt) {
    const s = this.s;
    if (this.stress) {
      // Keep 500+ rounds in the air: every enemy sprays its gun.
      for (const u of s.entities.air) if (u.team === TEAM.ENEMY && u.alive) u.forceGun = true;
      if (s.entities.counts.enemiesAlive < 50) {
        this.respawn -= dt;
        if (this.respawn <= 0) {
          this.respawn = 0.2;
          const a = Math.random() * Math.PI * 2;
          s.entities.spawnAir('fighter', TEAM.ENEMY, Math.cos(a) * 3000, 1500, Math.sin(a) * 3000, a, {});
        }
      }
      return;
    }
    if (this.duel) {
      if (!this._done && !this._down && s.time > 2 && s.entities.counts.enemiesAlive === 0) {
        this._done = true;
        s.hud?.message('BANDIT DOWN — DUEL WON', 3, '#8dffb5');
        s.after(3, () => s.game.finishSession({ mode: 'free', success: true, title: 'DUEL WON', subtitle: 'Bandit destroyed', score: s.score, credits: 0, kills: s.kills, stats: s.stats }));
      }
      return;
    }
    this.respawn -= dt;
    if (this.respawn <= 0) {
      this.respawn = 4;
      let drones = 0;
      let ground = 0;
      for (const u of s.entities.units) {
        if (!u.alive || u.team !== TEAM.ENEMY) continue;
        if (u.isAir) drones++;
        else ground++;
      }
      if (drones < 8) this.spawnDrone();
      if (ground < 6) {
        const p = s.world.terrain.findLand(this.center.x, this.center.z, 5000);
        if (p) s.entities.spawnGround(Math.random() < 0.5 ? 'truck' : 'tank', TEAM.ENEMY, p.x, p.z, Math.random() * 6, {});
      }
    }
  }

  hudLines(s) {
    return [`SCORE ${s.score}`, `KILLS ${s.kills}`];
  }

  onPlayerDown() {
    // Respawn after a short delay in free flight.
    if (this.s.ended || this._down) return;
    this._down = true;
    this.s.after(3.5, () => this.s.game.restartSession());
  }
}
