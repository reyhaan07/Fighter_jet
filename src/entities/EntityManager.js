import * as THREE from 'three';
import { Pool } from '../core/Pool.js';
import { Aircraft } from './Aircraft.js';
import { GroundUnit } from './GroundUnit.js';
import { Helicopter } from './Helicopter.js';
import { AIController } from './ai/AIDirector.js';
import { ROLE } from './ai/brain.js';
import { Loadout } from '../weapons/Loadout.js';
import { UNITS } from '../config/enemies.js';
import { TEAM } from './Unit.js';

// Owns every unit in the level. Units come from pools (no allocation once
// warm), are updated on the fixed timestep, inserted into the spatial hash
// for collisions, and drawn through the InstancedRenderer.

const _v = new THREE.Vector3();

export class EntityManager {
  constructor(session) {
    this.s = session;
    this.units = [];
    this.air = [];
    this.ground = [];
    this.byId = new Map();
    this.removeQueue = [];
    this.iterating = false;
    this.airPool = new Pool(() => new Aircraft(), { initial: 32 });
    this.groundPool = new Pool(() => new GroundUnit(), { initial: 32 });
    this.heliPool = new Pool(() => new Helicopter(), { initial: 8 });
    this.counts = { enemiesAlive: 0 };
  }

  add(u) {
    u._slot = this.units.length;
    this.units.push(u);
    if (u.isAir) this.air.push(u);
    else this.ground.push(u);
    this.byId.set(u.id, u);
    if (u.renderKey) this.s.models.ensure(u.renderKey);
  }

  remove(u) {
    if (!u.active) return;
    u.active = false;
    u.alive = false;
    if (this.iterating) this.removeQueue.push(u);
    else this._remove(u);
  }

  _remove(u) {
    const swapOut = (list, item) => {
      const i = list.indexOf(item);
      if (i >= 0) {
        list[i] = list[list.length - 1];
        list.pop();
      }
    };
    swapOut(this.units, u);
    swapOut(u.isAir ? this.air : this.ground, u);
    this.byId.delete(u.id);
    u.controller = null;
    u.loadout = null;
    u.target = null;
    u.parent = null;
    if (u.isPlayer) return;
    if (u instanceof Helicopter) this.heliPool.release(u);
    else if (u instanceof Aircraft) this.airPool.release(u);
    else this.groundPool.release(u);
  }

  /** Spawns an AI aircraft of a unit type (see config/enemies.js). */
  spawnAir(typeId, team, x, y, z, yaw = 0, opts = {}) {
    const def = UNITS[typeId];
    if (!def) throw new Error('Unknown unit ' + typeId);
    const s = this.s;
    if (def.role === 'heli') return this.spawnHeli(typeId, team, x, y, z, yaw, opts);
    const u = this.airPool.acquire();
    u.spawn(def, def.stats, team, x, y, z, yaw, opts.speed ?? def.stats.cornerSpeed);
    u.typeId = typeId;
    u.role = def.role;
    u.aiRole = def.role === 'bomber' ? ROLE.BOMBER : def.role === 'drone' ? ROLE.DRONE : ROLE.FIGHTER;
    if (opts.paint !== undefined) u.paint.set(opts.paint);
    const skill = Math.max(0, Math.min(1, s.difficulty.skill + (def.skill || 0) + (opts.skill || 0)));
    // Controllers and loadouts are cached on the pooled aircraft and reused.
    const c = u._ai ? u._ai.reset(skill) : (u._ai = new AIController(s.ai, skill));
    c.director = s.ai;
    u.controller = c;
    if (opts.waypoint) c.waypoint.copy(opts.waypoint);
    else c.waypoint.set(x, y, z);
    if (def.loadout) {
      u._loadouts ||= {};
      let lo = u._loadouts[typeId];
      if (!lo) {
        lo = u._loadouts[typeId] = new Loadout(u, def.loadout, {});
        if (lo.gun && team === TEAM.ENEMY) lo.gun.damage *= s.difficulty.aiGunDamage;
      } else lo.reset();
      u.loadout = lo;
    }
    if (team === TEAM.FRIEND && opts.wingman) {
      u.isWingman = true;
      u.aiRole = ROLE.WINGMAN;
      c.command = 2;
      u.paint.set(0x4c535c);
    }
    u.dmgMult = 1;
    u.onDeath = null;
    u.objective = opts.objective || null;
    this.add(u);
    if (def.turrets) s.spawnBomberTurrets?.(u, def);
    return u;
  }

  spawnHeli(typeId, team, x, y, z, yaw, opts = {}) {
    const def = UNITS[typeId];
    const u = this.heliPool.acquire();
    u.spawnHeli(def, team, x, y, z, yaw);
    u.typeId = typeId;
    u.role = 'heli';
    const skill = Math.max(0, Math.min(1, this.s.difficulty.skill + (def.skill || 0)));
    u.skill = skill;
    if (def.loadout) {
      u._loadouts ||= {};
      const lo = u._loadouts[typeId] || (u._loadouts[typeId] = new Loadout(u, def.loadout, {}));
      lo.reset();
      u.loadout = lo;
    }
    if (opts.waypoint) u.home.copy(opts.waypoint);
    u.objective = opts.objective || null;
    u.onDeath = null;
    this.add(u);
    return u;
  }

  /** Spawns a ground unit or ship. y is taken from the terrain/sea surface. */
  spawnGround(typeId, team, x, z, yaw = 0, opts = {}) {
    const def = UNITS[typeId];
    if (!def) throw new Error('Unknown unit ' + typeId);
    const u = this.groundPool.acquire();
    const y = opts.y ?? (def.kind === 'sea' ? 0 : this.s.world.surfaceAt(x, z));
    u.spawnGround(def, team, x, y, z, yaw);
    u.typeId = typeId;
    u.role = def.role;
    u.objective = opts.objective || null;
    u.onDeath = null;
    if (opts.path) u.setPath(opts.path);
    if (opts.parent) {
      u.parent = opts.parent;
      u.localOffset.copy(opts.offset);
      u.kind = 'part';
      u.isAir = opts.parent.isAir;
    }
    this.add(u);
    return u;
  }

  step(dt, ctx) {
    this.iterating = true;
    const list = this.units;
    for (let i = 0; i < list.length; i++) list[i].savePrev();
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (u.active) u.update(dt, ctx);
    }
    this.iterating = false;
    while (this.removeQueue.length) this._remove(this.removeQueue.pop());

    // Rebuild the collision broad-phase.
    const h = this.s.hash;
    h.clear();
    let enemies = 0;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (!u.alive) continue;
      h.insert(u);
      if (u.team === TEAM.ENEMY && u.isTarget) enemies++;
    }
    this.counts.enemiesAlive = enemies;
  }

  /** Interpolated transforms for rendering (call before the camera update). */
  interpolate(alpha) {
    const list = this.units;
    for (let i = 0; i < list.length; i++) list[i].interpolate(alpha);
  }

  render(instanced, glows, camera) {
    const list = this.units;
    for (let i = 0; i < list.length; i++) {
      const u = list[i];
      if (u.isPlayer || !u.renderKey) continue;
      if (u.hidden) continue;
      instanced.add(u.renderKey, u.renderPos, u.renderQuat, u.renderScale || 1, u.paint);
      // Engine glow for jets (cheap stand-in for the player's afterburner shader).
      if (u.isAir && u.flight && u.kind === 'air') {
        const ab = u.flight.afterburner;
        const k = 0.4 + u.flight.throttle * 0.4 + ab;
        _v.set(0, 0, u.def.radius * 0.95).applyQuaternion(u.renderQuat).add(u.renderPos);
        if (_v.distanceToSquared(camera.position) < 9e6 || ab > 0.3) glows.add(_v.x, _v.y, _v.z, 2 + ab * 3, 3 * k, 1.6 * k, 0.7 * k, 0.6);
      }
    }
  }

  clear() {
    this.iterating = false;
    for (const u of [...this.units]) this.remove(u);
    this.removeQueue.length = 0;
  }
}
