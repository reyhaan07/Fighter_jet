import * as THREE from 'three';
import { think, A_STRIDE, O_STRIDE, M_STRIDE, MO_STRIDE, A, ROLE, FLAG, OUT } from './brain.js';
import { steerToward } from '../FlightModel.js';

// Feeds the AI brain. Each simulation step it packs every aircraft and guided
// missile into flat typed arrays, runs the brain (inline, or in a Web Worker
// once the fight is big) and applies the resulting decisions to the units.
// With the worker, decisions arrive one or two steps late; pilots simply keep
// flying their last decision in between, which is imperceptible.

const MAX_AIR = 256;
const MAX_MIS = 512;
const WORKER_THRESHOLD = 24; // aircraft + guided missiles

const _dir = new THREE.Vector3();

export class AIController {
  constructor(director, skill) {
    this.director = director;
    this.reset(skill);
  }

  reset(skill) {
    this.skill = skill;
    this.throttle = 0.8;
    this.flags = 0;
    this.mode = 0;
    this.timer = 0;
    this.targetId = -1;
    this.command = 2;
    this.commandTarget = null;
    this.waypoint ||= new THREE.Vector3();
    this.waypoint.set(0, 0, 0);
    this.dir ||= new THREE.Vector3();
    this.dir.set(0, 0, -1);
    this.hasDecision = false;
    return this;
  }

  update(u, dt) {
    if (!this.hasDecision) {
      this.dir.set(0, 0, -1).applyQuaternion(u.quat);
      this.hasDecision = true;
    }
    steerToward(u, this.dir, 0.75 + this.skill * 0.4, 1);
    const f = u.flight;
    f.throttleTarget = this.throttle;
    f.controls.ab = (this.flags & OUT.AB) !== 0;
    f.controls.brake = (this.flags & OUT.BRAKE) !== 0;
    const t = u.trigger;
    t.gun = (this.flags & OUT.GUN) !== 0 || u.forceGun === true;
    const sec = (this.flags & OUT.MISSILE) !== 0;
    t.secondaryPressed = sec && !t.secondary;
    t.secondaryReleased = !sec && t.secondary;
    t.secondary = sec;
    t.flares = (this.flags & OUT.FLARES) !== 0;
    u.target = this.targetId >= 0 ? this.director.entities.byId.get(this.targetId) || null : null;
    if (u.target && !u.target.alive) u.target = null;
  }
}

export class AIDirector {
  constructor(session) {
    this.s = session;
    this.entities = session.entities;
    this.air = new Float32Array(MAX_AIR * A_STRIDE);
    this.out = new Float32Array(MAX_AIR * O_STRIDE);
    this.mis = new Float32Array(MAX_MIS * M_STRIDE);
    this.misOut = new Float32Array(MAX_MIS * MO_STRIDE);
    this.airUnits = new Array(MAX_AIR).fill(null);
    this.misUnits = new Array(MAX_MIS).fill(null);
    this.inflight = false;
    this.worker = null;
    this.useWorker = false;
    this.lastThink = 0;
    this.workerFailed = false;
    this.msg = null;
    this.stats = { mode: 'inline', air: 0, missiles: 0, latency: 0 };
    this.stamp = 0;
  }

  _ensureWorker() {
    if (this.worker || this.workerFailed) return !!this.worker;
    try {
      this.worker = new Worker(new URL('./ai.worker.js', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e) => this._onResult(e.data);
      this.worker.onerror = () => {
        this.workerFailed = true;
        this.worker?.terminate();
        this.worker = null;
        this.inflight = false;
      };
      return true;
    } catch {
      this.workerFailed = true;
      return false;
    }
  }

  step(dt) {
    const s = this.s;
    const count = this.entities.air.length + s.ordnance.guidedCount;
    this.useWorker = count > WORKER_THRESHOLD && this._ensureWorker();
    this.stats.mode = this.useWorker ? 'worker' : 'inline';
    if (this.useWorker) {
      if (!this.inflight) {
        const nAir = this._packAir();
        const nMis = this._packMissiles();
        const m = this.msg || (this.msg = {});
        m.air = this.air;
        m.mis = this.mis;
        m.out = this.out;
        m.misOut = this.misOut;
        m.nAir = nAir;
        m.nMis = nMis;
        m.time = s.time;
        m.dt = s.time - this.lastThink || dt;
        m.mapHalf = s.mapHalf;
        m.sent = s.time;
        this.lastThink = s.time;
        this.inflight = true;
        this.worker.postMessage(m, [this.air.buffer, this.mis.buffer, this.out.buffer, this.misOut.buffer]);
      }
    } else {
      const nAir = this._packAir();
      const nMis = this._packMissiles();
      think(this.air, nAir, this.mis, nMis, this.out, this.misOut, s.time, s.time - this.lastThink || dt, s.mapHalf);
      this.lastThink = s.time;
      this._adopt(this.out, nAir, this.misOut, nMis);
    }
  }

  _onResult(m) {
    // Take the buffers back and adopt their decisions.
    this.air = m.air;
    this.mis = m.mis;
    this.out = m.out;
    this.misOut = m.misOut;
    this.inflight = false;
    this.stats.latency = this.s.time - m.sent;
    this._adopt(m.out, m.nAir, m.misOut, m.nMis);
  }

  /**
   * Writes decisions into the controllers / missiles they were computed for.
   * airUnits/misUnits still describe the snapshot that produced them (a new
   * snapshot is only packed once the previous result came back).
   */
  _adopt(dec, nAir, md, nMis) {
    for (let i = 0; i < nAir; i++) {
      const u = this.airUnits[i];
      const r = i * O_STRIDE;
      if (!u || u.id !== dec[r] || !u.alive) continue;
      const c = u.controller;
      if (!(c instanceof AIController)) continue;
      c.dir.set(dec[r + 1], dec[r + 2], dec[r + 3]);
      if (c.dir.lengthSq() < 0.5) c.dir.set(0, 0, -1).applyQuaternion(u.quat);
      c.throttle = dec[r + 4];
      c.flags = dec[r + 5];
      c.targetId = dec[r + 6];
      c.mode = dec[r + 7];
      c.timer = dec[r + 8];
      c.hasDecision = true;
    }
    for (let i = 0; i < nMis; i++) {
      const m = this.misUnits[i];
      const o = i * MO_STRIDE;
      if (!m || m.id !== md[o] || !m.alive) continue;
      m.guideDir.set(md[o + 1], md[o + 2], md[o + 3]);
      m.hasGuide = true;
    }
  }

  _packAir() {
    this.stamp++;
    const list = this.entities.air;
    const a = this.air;
    const world = this.s.world;
    let n = 0;
    for (let i = 0; i < list.length && n < MAX_AIR; i++) {
      const u = list[i];
      if (!u.alive || u.role === 'heli') continue;
      const o = n * A_STRIDE;
      const c = u.controller instanceof AIController ? u.controller : null;
      u._aiIndex = n;
      u._aiStamp = this.stamp;
      this.airUnits[n] = u;
      a[o + A.ID] = u.id;
      a[o + A.TEAM] = u.team;
      a[o + A.ROLE] = u.isPlayer ? ROLE.PLAYER : u.isWingman ? ROLE.WINGMAN : u.aiRole ?? ROLE.FIGHTER;
      a[o + A.SKILL] = c ? c.skill : 1;
      a[o + A.PX] = u.pos.x;
      a[o + A.PX + 1] = u.pos.y;
      a[o + A.PX + 2] = u.pos.z;
      a[o + A.VX] = u.vel.x;
      a[o + A.VX + 1] = u.vel.y;
      a[o + A.VX + 2] = u.vel.z;
      _dir.set(0, 0, -1).applyQuaternion(u.quat);
      a[o + A.FX] = _dir.x;
      a[o + A.FX + 1] = _dir.y;
      a[o + A.FX + 2] = _dir.z;
      _dir.set(0, 1, 0).applyQuaternion(u.quat);
      a[o + A.UX] = _dir.x;
      a[o + A.UX + 1] = _dir.y;
      a[o + A.UX + 2] = _dir.z;
      a[o + A.HP] = u.hp / u.maxHp;
      const lo = u.loadout;
      let flags = FLAG.ALIVE;
      if (lo?.gun) flags |= FLAG.GUN;
      if (lo?.current && lo.current.ammo >= 1) flags |= FLAG.MISSILE;
      if (u.isPlayer) flags |= FLAG.PLAYER;
      if (lo?.flares && lo.flares.ammo >= 1) flags |= FLAG.FLARES;
      a[o + A.FLAGS] = flags;
      a[o + A.THREAT] = -1;
      a[o + A.CMD] = c ? c.command : 0;
      a[o + A.CMD_TARGET] = c?.commandTarget?.alive ? c.commandTarget.id : -1;
      a[o + A.LEADER] = -1;
      a[o + A.MODE] = c ? c.mode : 0;
      a[o + A.TIMER] = c ? c.timer : 0;
      const vx = u.vel.x;
      const vz = u.vel.z;
      a[o + A.GROUND] = Math.max(
        world.surfaceAt(u.pos.x, u.pos.z),
        world.surfaceAt(u.pos.x + vx * 3, u.pos.z + vz * 3),
        world.surfaceAt(u.pos.x + vx * 6, u.pos.z + vz * 6),
      );
      a[o + A.TARGET] = c ? c.targetId : -1;
      a[o + A.WX] = c ? c.waypoint.x : 0;
      a[o + A.WX + 1] = c ? c.waypoint.y : 0;
      a[o + A.WX + 2] = c ? c.waypoint.z : 0;
      a[o + A.GUN_RANGE] = lo?.gun ? lo.gun.def.range * 0.8 : 0;
      a[o + A.MIS_RANGE] = lo?.current?.def.range ? lo.current.def.range * 0.8 : 0;
      a[o + A.SIG] = u.signature * (u.ecm > 0 ? 0.4 : 1);
      n++;
    }
    // Leader index for wingmen (the player).
    const p = this.s.player;
    if (p && p.alive && p._aiStamp === this.stamp) {
      for (let i = 0; i < n; i++) if (this.airUnits[i].isWingman) a[i * A_STRIDE + A.LEADER] = p._aiIndex;
    }
    this.stats.air = n;
    return n;
  }

  _packMissiles() {
    const ord = this.s.ordnance.active;
    const m = this.mis;
    const a = this.air;
    let n = 0;
    for (let i = 0; i < ord.length && n < MAX_MIS; i++) {
      const o = ord[i];
      if (!o.guided) continue;
      const k = n * M_STRIDE;
      m[k] = o.id;
      m[k + 1] = o.team;
      m[k + 2] = o.pos.x;
      m[k + 3] = o.pos.y;
      m[k + 4] = o.pos.z;
      m[k + 5] = o.vel.x;
      m[k + 6] = o.vel.y;
      m[k + 7] = o.vel.z;
      const has = o.seekPos !== null && o.trackValid;
      if (has) {
        m[k + 8] = o.seekPos.x;
        m[k + 9] = o.seekPos.y;
        m[k + 10] = o.seekPos.z;
        m[k + 11] = o.seekVel.x;
        m[k + 12] = o.seekVel.y;
        m[k + 13] = o.seekVel.z;
      }
      m[k + 14] = o.def.lead ?? 1;
      m[k + 15] = has ? 1 : -1;
      // Tell the targeted aircraft about the closest incoming missile.
      const t = o.target;
      if (t && t.isAir && t._aiStamp === this.stamp && o.team !== t.team) {
        const ta = t._aiIndex * A_STRIDE;
        const cur = a[ta + A.THREAT];
        if (cur < 0) a[ta + A.THREAT] = n;
        else {
          const c = cur * M_STRIDE;
          const d0 = (m[c + 2] - t.pos.x) ** 2 + (m[c + 3] - t.pos.y) ** 2 + (m[c + 4] - t.pos.z) ** 2;
          const d1 = (o.pos.x - t.pos.x) ** 2 + (o.pos.y - t.pos.y) ** 2 + (o.pos.z - t.pos.z) ** 2;
          if (d1 < d0) a[ta + A.THREAT] = n;
        }
      }
      this.misUnits[n] = o;
      n++;
    }
    this.stats.missiles = n;
    return n;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.airUnits.fill(null);
    this.misUnits.fill(null);
  }
}
