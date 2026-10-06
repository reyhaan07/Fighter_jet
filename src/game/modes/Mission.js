import * as THREE from 'three';
import { TEAM } from '../../entities/Unit.js';
import { rng } from '../../core/math.js';

// Campaign mission runner: executes a mission's setup script through a
// small spawning API, tracks objectives, fires scripted waves and decides
// success or failure.

const _v = new THREE.Vector3();

export class Mission {
  constructor(s, mission) {
    this.s = s;
    this.m = mission.def;
    this.objectives = [];
    this.waveList = [];
    this.startTime = 0;
    this.finished = false;
    this.bossUnit = null;
    this.rand = rng(this.m.env.seed * 7 + 3);
    this.waypoint = null;
  }

  // ── Spawning API used by config/missions.js ─────────────────────────
  _point(x, z, spread) {
    const a = this.rand() * Math.PI * 2;
    const r = Math.sqrt(this.rand()) * spread;
    return { x: x + Math.cos(a) * r, z: z + Math.sin(a) * r };
  }

  air(type, count, { x = 0, z = 0, alt = 1800, spread = 1000, objective = null, waypoint = null, skill = 0 } = {}) {
    const s = this.s;
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = this._point(x, z, spread);
      const ground = s.world.surfaceAt(p.x, p.z);
      const y = type === 'heli' ? ground + alt : Math.max(alt + (this.rand() - 0.5) * 300, ground + 500);
      // Face the player's start so fights begin quickly.
      const st = this.m.start;
      const yaw = Math.atan2(p.x - st.x, p.z - st.z);
      const opts = { objective, skill };
      if (waypoint) opts.waypoint = _v.set(waypoint.x + (p.x - x), waypoint.y ?? y, waypoint.z + (p.z - z));
      else if (type === 'heli') opts.waypoint = _v.set(p.x, y, p.z);
      out.push(s.entities.spawnAir(type, TEAM.ENEMY, p.x, y, p.z, yaw, opts));
    }
    return out;
  }

  ground(type, count, { x = 0, z = 0, spread = 1000, objective = null } = {}) {
    const s = this.s;
    const out = [];
    for (let i = 0; i < count; i++) {
      const p = s.world.terrain.findLand(x, z, spread, 4, 900, this.rand) || this._point(x, z, spread);
      out.push(s.entities.spawnGround(type, TEAM.ENEMY, p.x, p.z, this.rand() * Math.PI * 2, { objective }));
    }
    return out;
  }

  sea(type, count, { x = 0, z = 0, spread = 1000, objective = null, patrol = 0 } = {}) {
    const s = this.s;
    const out = [];
    for (let i = 0; i < count; i++) {
      // Search wider and wider until open water is found (ships never spawn on land).
      let p = null;
      for (const r of [Math.max(spread, 300), 4000, 8000, 14000]) {
        p = s.world.terrain.findSea(x, z, r, this.rand);
        if (p) break;
      }
      p ||= { x: x + i * 400, z };
      const opts = { objective, y: 0 };
      if (patrol) {
        const path = [];
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          path.push({ x: p.x + Math.cos(a) * patrol, z: p.z + Math.sin(a) * patrol });
        }
        opts.path = path;
      }
      out.push(s.entities.spawnGround(type, TEAM.ENEMY, p.x, p.z, this.rand() * Math.PI * 2, opts));
      this._shipGuns(out[out.length - 1]);
    }
    return out;
  }

  _shipGuns(ship) {
    const guns = ship.def.aaGuns;
    if (!guns) return;
    for (const g of guns) {
      _v.set(g[0], g[1], g[2]);
      this.s.entities.spawnGround('fortressTurret', ship.team, ship.pos.x, ship.pos.z, 0, { parent: ship, offset: _v, y: ship.pos.y });
    }
  }

  convoy(type, count, { from, to, objective = null }) {
    const s = this.s;
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = i / Math.max(1, count - 1);
      const x = from.x + (to.x - from.x) * t * 0.15 + (i % 2) * 20;
      const z = from.z + (to.z - from.z) * t * 0.15;
      const u = s.entities.spawnGround(type, TEAM.ENEMY, x, z, Math.atan2(-(to.x - from.x), -(to.z - from.z)), { objective, path: [{ x: to.x + (i % 2) * 20, z: to.z }] });
      out.push(u);
    }
    return out;
  }

  friendly(type, count, { x, z, alt, to, objective }) {
    const s = this.s;
    const out = [];
    const yaw = Math.atan2(-(to.x - x), -(to.z - z));
    for (let i = 0; i < count; i++) {
      const px = x + (i - 1) * 120;
      const pz = z + i * 90;
      const u = s.entities.spawnAir(type, TEAM.FRIEND, px, alt + i * 30, pz, yaw, { objective, waypoint: _v.set(to.x + (i - 1) * 120, alt, to.z) });
      u.isTarget = true;
      out.push(u);
    }
    return out;
  }

  boss({ x, z, alt, hpMult = 1 }) {
    const s = this.s;
    const path = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      path.push({ x: x + Math.cos(a) * 3500, z: z + Math.sin(a) * 2500 });
    }
    const b = s.entities.spawnGround('fortress', TEAM.ENEMY, x, z, 0, { y: alt, path, objective: 'boss' });
    b.flying = true;
    b.isAir = true;
    b.ghost = true; // the hull itself is not a hitbox: hit the weak points
    b.heat = 1;
    this.bossUnit = b;
    this.engines = [];
    this.turrets = [];
    for (const [ex, ey, ez] of [[-62, -4, 22], [-30, -4, 30], [30, -4, 30], [62, -4, 22]]) {
      _v.set(ex, ey, ez);
      const e = s.entities.spawnGround('fortressEngine', TEAM.ENEMY, x, z, 0, { parent: b, offset: _v, y: alt, objective: 'engines' });
      e.hp = e.maxHp = e.maxHp * hpMult;
      this.engines.push(e);
    }
    for (const [tx, ty, tz] of [[-80, 4, 0], [-45, 8, -20], [0, 15, -30], [45, 8, -20], [80, 4, 0], [0, -10, 20]]) {
      _v.set(tx, ty, tz);
      this.turrets.push(s.entities.spawnGround('fortressTurret', TEAM.ENEMY, x, z, 0, { parent: b, offset: _v, y: alt }));
    }
    _v.set(0, 16, 5);
    this.core = s.entities.spawnGround('fortressCore', TEAM.ENEMY, x, z, 0, { parent: b, offset: _v, y: alt, objective: 'core' });
    this.core.hp = this.core.maxHp = this.core.maxHp * hpMult;
    this.core.invulnerable = true;
    this.core.isTarget = false;
    this.objective('engines', 'Destroy the 4 engines', { kind: 'destroy', group: 'engines', count: 4 });
    return b;
  }

  objective(id, label, { kind = 'destroy', group = id, count = 1, failIfLost = 0, zone = null } = {}) {
    this.objectives.push({ id, label, kind, group, count, failIfLost, zone, killed: 0, lost: 0, done: false, failed: false });
  }

  waves(list) {
    for (const w of list) this.waveList.push({ ...w, fired: false });
  }

  // ── Mode hooks ──────────────────────────────────────────────────────
  setup() {
    const s = this.s;
    s.spawnWingmen(this.m.wingmen ?? 0);
    this.m.setup(this);
    s.hud?.message(this.m.name.toUpperCase(), 4, '#ffcf5a');
    s.hud?.message(this.objectives[0]?.label || '', 5, '#7fd4ff');
    s.radio('AWACS', `${this.m.name}: ${this.objectives[0]?.label}. Good hunting.`);
  }

  onKill(u) {
    if (!u.objective) return;
    for (const o of this.objectives) {
      if (o.group !== u.objective) continue;
      if (o.kind === 'destroy') o.killed++;
      if (o.kind === 'protect' || o.kind === 'escort') {
        o.lost++;
        if (o.kind === 'protect' && o.lost > o.failIfLost) o.failed = true;
      }
      if (o.kind === 'intercept') o.killed++;
    }
    if (u.objective === 'engines' && this.engines) {
      const left = this.engines.filter((e) => e.alive).length;
      if (left > 0) this.s.radio('AWACS', `Engine down! ${left} to go.`);
      else {
        this.core.invulnerable = false;
        this.core.isTarget = true;
        this.s.radio('AWACS', 'All engines down, the reactor core is exposed! Hit it with everything!', 4, true);
        this.s.hud?.message('REACTOR CORE EXPOSED', 3, '#ff5a4a');
        this.objective('core', 'Destroy the reactor core', { kind: 'destroy', group: 'core', count: 1 });
      }
    }
    if (u.objective === 'core' && this.bossUnit?.active) {
      // Boss kill: chain explosions, slow motion, kill cam.
      const s = this.s;
      s.slowMo = 3;
      s.cameraRig.killCam(this.bossUnit.pos, 3.5);
      for (let i = 0; i < 6; i++) {
        _v.set((Math.random() - 0.5) * 200, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 120).add(this.bossUnit.pos);
        s.fx.explosion(_v.x, _v.y, _v.z, 40 + Math.random() * 40);
      }
      s.combat.kill(this.bossUnit, s.player, 'core');
      for (const o of this.objectives) if (o.kind === 'boss') o.done = true;
    }
  }

  step(dt) {
    if (this.finished) return;
    const s = this.s;
    const t = s.time - this.startTime;
    // Scripted waves.
    let enemyAir = 0;
    for (const u of s.entities.air) if (u.alive && u.team === TEAM.ENEMY) enemyAir++;
    for (const w of this.waveList) {
      if (w.fired) continue;
      if ((w.at === 'cleared' && enemyAir === 0 && t > 5) || (typeof w.at === 'number' && t >= w.at)) {
        w.fired = true;
        w.spawn(this);
        s.radio('AWACS', 'New contacts inbound!');
      }
    }
    // Zone objectives.
    for (const o of this.objectives) {
      if (o.done || o.failed) continue;
      if (o.kind === 'destroy' && o.killed >= o.count) {
        o.done = true;
        s.hud?.message(`${o.label}: COMPLETE`, 3, '#8dffb5');
      } else if (o.kind === 'intercept' || o.kind === 'escort') {
        let alive = 0;
        let inZone = 0;
        for (const u of s.entities.units) {
          if (!u.alive || u.objective !== o.group) continue;
          alive++;
          const dx = u.pos.x - o.zone.x;
          const dz = u.pos.z - o.zone.z;
          if (dx * dx + dz * dz < o.zone.r * o.zone.r) inZone++;
        }
        if (o.kind === 'intercept') {
          if (inZone > 0) o.failed = true;
          else if (alive === 0 && o.killed > 0) o.done = true;
        } else if (alive > 0 && inZone === alive) o.done = true;
        else if (alive === 0) o.failed = true;
        if (o.kind === 'escort' || o.kind === 'intercept') this.waypoint = o.zone;
      }
    }
    // Protect objectives complete together with everything else.
    const others = this.objectives.filter((o) => o.kind !== 'protect');
    if (others.length && others.every((o) => o.done)) for (const o of this.objectives) if (o.kind === 'protect' && !o.failed) o.done = true;

    if (this.objectives.some((o) => o.failed)) this._end(false, this.objectives.find((o) => o.failed).label);
    else if (this.objectives.length && this.objectives.every((o) => o.done)) this._end(true);
  }

  hudLines() {
    const lines = [this.m.name.toUpperCase()];
    for (const o of this.objectives) {
      if (o.done) continue;
      let txt = o.label;
      if (o.kind === 'destroy') txt += `  ${o.killed}/${o.count}`;
      if (o.kind === 'protect') txt += `  lost ${o.lost}/${o.failIfLost + 1}`;
      lines.push((o.failed ? '! ' : '· ') + txt);
    }
    lines.push(`SCORE ${this.s.score}`);
    return lines;
  }

  onPlayerDown() {
    this._end(false, 'You were shot down');
  }

  _end(success, reason = '') {
    if (this.finished) return;
    this.finished = true;
    const s = this.s;
    if (success) {
      s.hud?.message('MISSION ACCOMPLISHED', 4, '#8dffb5');
      s.radio('AWACS', 'Mission accomplished. Return to base.');
    } else {
      s.hud?.message('MISSION FAILED', 4, '#ff5a4a');
    }
    const delay = success ? 4500 : 3500;
    setTimeout(() => {
      if (s.game.session !== s) return;
      s.game.finishSession({
        mode: 'campaign',
        missionId: this.m.id,
        success,
        title: success ? 'MISSION ACCOMPLISHED' : 'MISSION FAILED',
        subtitle: success ? this.m.name : reason,
        score: s.score + (success ? this.m.reward : 0),
        credits: s.creditsEarned + (success ? Math.round(this.m.reward * s.difficulty.reward) : 0),
        kills: s.kills,
        stats: s.stats,
        time: s.time,
      });
    }, delay);
  }
}
