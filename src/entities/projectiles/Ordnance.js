import * as THREE from 'three';
import { Pool } from '../../core/Pool.js';
import { WEAPONS } from '../../weapons/registry.js';
import { segmentPointDist2, rand } from '../../core/math.js';

// Pooled guided and unguided ordnance: missiles, rockets, bombs, bomblets,
// the steerable cruise missile and deployable drones; plus flare/chaff decoys
// and napalm fire zones. Guidance directions come from the AI brain (main
// thread or worker); seekers, motors, fuzes and decoys run here.

let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const FWD = new THREE.Vector3(0, 0, -1);
const UP = new THREE.Vector3(0, 1, 0);

class Ord {
  constructor() {
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.prevQuat = new THREE.Quaternion();
    this.renderPos = new THREE.Vector3();
    this.renderQuat = new THREE.Quaternion();
    this.guideDir = new THREE.Vector3();
    this._seekPos = new THREE.Vector3();
    this._seekVel = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();
    this.seekPos = null;
    this.seekVel = this._seekVel;
    this.reset();
  }
  reset() {
    this.id = 0;
    this.alive = false;
    this.def = null;
    this.owner = null;
    this.target = null;
    this.decoy = null;
    this.team = 0;
    this.guided = false;
    this.hasGuide = false;
    this.trackValid = false;
    this.seekPos = null;
    this.life = 0;
    this.age = 0;
    this.trail = 0;
    this.player = false;
    this.steer = false;
    this.fuel = 0;
    this.speed = 0;
    this.hits = 0;
    this.drone = null;
    this.radius = 0.5;
  }
}

class Decoy {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.life = 0;
    this.type = 'flare';
    this.team = 0;
    this.strength = 1;
  }
}

class FireZone {
  constructor() {
    this.pos = new THREE.Vector3();
    this.life = 0;
    this.radius = 0;
    this.dps = 0;
    this.owner = null;
    this.team = 0;
    this.tick = 0;
    this.def = null;
  }
}

export class Ordnance {
  constructor(session) {
    this.s = session;
    this.pool = new Pool(() => new Ord(), { initial: 256, max: 1024, reset: (o) => o.reset() });
    this.decoys = new Pool(() => new Decoy(), { initial: 64, max: 256 });
    this.fires = new Pool(() => new FireZone(), { initial: 16, max: 64 });
    this.guidedCount = 0;
    this.cruise = null; // the player's steerable cruise missile, if in flight
  }

  get active() {
    return this.pool.active;
  }

  /**
   * Launch ordnance. def: weapon config id or object. target: Unit or null.
   * dir: initial direction. speed0: launch speed (usually owner speed).
   */
  launch(defOrId, owner, target, pos, dir, speed0, opts = {}) {
    const def = typeof defOrId === 'string' ? WEAPONS[defOrId] : defOrId;
    const o = this.pool.acquire();
    if (!o) return null;
    o.id = NEXT_ID++;
    o.alive = true;
    o.def = def;
    o.owner = owner;
    o.team = owner ? owner.team : 1;
    o.player = !!owner?.isPlayer;
    o.target = target || null;
    o.decoy = null;
    o.kind = def.ordnance || 'missile';
    o.guided = !!def.guidance && def.guidance !== 'none';
    o.hasGuide = false;
    o.pos.copy(pos);
    o.prevPos.copy(pos);
    o.vel.copy(dir).multiplyScalar(speed0);
    o.speed = speed0;
    o.quat.setFromUnitVectors(FWD, dir);
    o.prevQuat.copy(o.quat);
    o.life = def.life ?? 12;
    o.age = 0;
    o.fuel = def.burn ?? 3;
    o.trail = Math.random() * 0.05;
    o.steer = !!opts.steer;
    o.damage = opts.damage ?? def.damage ?? 30;
    o.hits = 0;
    o.radius = def.hitRadius ?? 0.5;
    o.guideDir.copy(dir);
    o.trackValid = false;
    o.seekPos = null;
    if (opts.aimPoint) o.aimPoint.copy(opts.aimPoint);
    if (o.kind === 'drone') o.droneFire = 0;
    if (target) target.lockedBy++;
    this._seek(o);
    if (o.steer && o.player) this.cruise = o;
    return o;
  }

  /** Drop a flare or chaff bundle. */
  decoy(type, owner) {
    const d = this.decoys.acquire();
    if (!d) return;
    d.type = type;
    d.team = owner.team;
    d.pos.copy(owner.pos);
    d.vel.copy(owner.vel).multiplyScalar(0.6);
    _v.set(rand(-1, 1), rand(-1.5, -0.2), rand(-0.2, 0.6)).applyQuaternion(owner.quat).multiplyScalar(type === 'flare' ? 35 : 25);
    d.vel.add(_v);
    d.life = type === 'flare' ? 3.2 : 4.5;
    d.strength = type === 'flare' ? 1 + owner.heat * 0.1 : 1;
    if (type === 'flare') this.s.fx.flareBurst(d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.vel.y, d.vel.z);
    else this.s.fx.chaff(d.pos.x, d.pos.y, d.pos.z, d.vel.x, d.vel.y, d.vel.z);
  }

  fireZone(pos, radius, dps, life, owner, def) {
    const f = this.fires.acquire();
    if (!f) return;
    f.pos.copy(pos);
    f.radius = radius;
    f.dps = dps;
    f.life = life;
    f.owner = owner;
    f.team = owner ? owner.team : 1;
    f.def = def;
    f.tick = 0;
  }

  /** Seeker: picks the aim point (target, decoy, laser spot) and validity. */
  _seek(o) {
    const def = o.def;
    const g = def.guidance;
    const t = o.target;
    o.trackValid = false;
    if (!o.guided) return;
    if (g === 'laser' || g === 'gps') {
      // Laser-guided bombs ride the designator (player's aim) or a fixed point.
      if (t && t.alive) o._seekPos.copy(t.pos);
      else o._seekPos.copy(o.aimPoint);
      o._seekVel.set(0, 0, 0);
      if (t?.alive) o._seekVel.copy(t.vel);
      o.seekPos = o._seekPos;
      o.trackValid = true;
      return;
    }
    if (o.decoy) {
      if (o.decoy.life > 0) {
        o._seekPos.copy(o.decoy.pos);
        o._seekVel.copy(o.decoy.vel);
        o.seekPos = o._seekPos;
        o.trackValid = true;
      }
      return;
    }
    if (!t || !t.active || (!t.alive && !t.dying)) return;
    // Seeker gimbal limit: lose lock if the target leaves the cone.
    _d.copy(t.pos).sub(o.pos);
    const dist = _d.length();
    _v.copy(o.vel).normalize();
    const cos = _v.dot(_d) / Math.max(dist, 1e-3);
    if (o.age > 0.3 && cos < (def.gimbal ?? 0.5) && dist > 60) {
      t.lockedBy = Math.max(0, t.lockedBy - 1);
      o.target = null;
      return;
    }
    o._seekPos.copy(t.pos);
    o._seekVel.copy(t.vel);
    o.seekPos = o._seekPos;
    o.trackValid = true;
  }

  /** Flares spoof IR seekers, chaff and ECM spoof radar seekers. */
  _decoyCheck(o, dt) {
    const g = o.def.guidance;
    if (o.decoy || !o.target) return;
    const resist = o.def.decoyResist ?? 0.3;
    const list = this.decoys.active;
    for (let i = 0; i < list.length; i++) {
      const d = list[i];
      if (d.team !== o.target.team) continue;
      if ((g === 'ir' && d.type !== 'flare') || (g === 'radar' && d.type !== 'chaff') || (g !== 'ir' && g !== 'radar')) continue;
      _d.copy(d.pos).sub(o.pos);
      const dist = _d.length();
      if (dist > 2500) continue;
      _v.copy(o.vel).normalize();
      if (_v.dot(_d) / dist < 0.7) continue;
      // Chance per second the seeker jumps to the decoy.
      const p = (1 - resist) * d.strength * 2.2 * dt * (g === 'ir' ? 1 / Math.max(0.4, o.target.heat) : 1);
      if (Math.random() < p) {
        o.decoy = d;
        o.target.lockedBy = Math.max(0, o.target.lockedBy - 1);
        this.s.events.emit('decoyed', o);
        return;
      }
    }
    if (g === 'radar' && o.target.ecm > 0 && Math.random() < dt * 0.9 * (1 - resist)) {
      o.target.lockedBy = Math.max(0, o.target.lockedBy - 1);
      o.target = null;
      this.s.events.emit('decoyed', o);
    }
  }

  step(dt, ctx) {
    const list = this.pool.active;
    let guided = 0;
    for (let i = list.length - 1; i >= 0; i--) {
      const o = list[i];
      o.prevPos.copy(o.pos);
      o.prevQuat.copy(o.quat);
      o.age += dt;
      o.life -= dt;
      if (o.guided) guided++;
      if (o.kind === 'drone') this._drone(o, dt, ctx);
      else this._fly(o, dt, ctx);
      if (o.alive && o.life <= 0) this.detonate(o, null, o.kind !== 'drone');
    }
    this.guidedCount = guided;
    this._stepDecoys(dt);
    this._stepFires(dt, ctx);
  }

  _fly(o, dt, ctx) {
    const def = o.def;
    const kind = o.kind;
    // Motor / drag.
    if (kind === 'bomb' || kind === 'bomblet') {
      o.vel.y -= 9.81 * dt;
      o.vel.multiplyScalar(1 - 0.02 * dt);
    } else {
      if (o.age > (def.motorDelay ?? 0)) {
        if (o.fuel > 0) {
          o.fuel -= dt;
          o.speed = Math.min(def.speed, o.speed + (def.accel ?? 250) * dt);
        } else o.speed *= 1 - 0.15 * dt;
      } else o.vel.y -= 9.81 * dt; // dropped from the rail before ignition
      o.speed = Math.max(o.speed, 60);
    }

    // Steering.
    if (kind === 'bomb' || kind === 'bomblet') o.quat.setFromUnitVectors(FWD, _v.copy(o.vel).normalize());
    if (o.steer && o.player) {
      // Player-steered cruise missile: guideDir is written by the Session.
      this._turn(o, o.guideDir, def.turnRate * dt);
    } else if (o.guided && o.age > (def.motorDelay ?? 0) + 0.12) {
      this._seek(o);
      this._decoyCheck(o, dt);
      if (o.trackValid && o.hasGuide) {
        _d.copy(o.guideDir);
        if (def.seaSkim && o.target) {
          // Hug the waves until the final pop-up.
          const hd = Math.hypot(o.target.pos.x - o.pos.x, o.target.pos.z - o.pos.z);
          if (hd > 900) _d.y = (14 - o.pos.y) * 0.01;
          _d.normalize();
        }
        if (def.wobble) {
          _d.x += Math.sin(o.age * 7 + o.id) * def.wobble;
          _d.y += Math.cos(o.age * 6 + o.id * 3) * def.wobble;
          _d.normalize();
        }
        const rate = (kind === 'bomb' ? def.turnRate : def.turnRate * Math.min(1, o.speed / 300)) * dt;
        this._turn(o, _d, rate);
      }
    }
    if (kind === 'bomb' || kind === 'bomblet') {
      // Bombs point along their velocity; guided bombs steer that velocity.
      const sp = o.vel.length();
      if (o.guided && o.trackValid && o.hasGuide) {
        _v.set(0, 0, -1).applyQuaternion(o.quat);
        o.vel.copy(_v).multiplyScalar(sp);
      }
      o.quat.setFromUnitVectors(FWD, _v.copy(o.vel).divideScalar(Math.max(sp, 1e-3)));
    } else {
      _v.set(0, 0, -1).applyQuaternion(o.quat);
      o.vel.copy(_v).multiplyScalar(o.speed);
    }
    o.pos.addScaledVector(o.vel, dt);

    // Cluster bombs burst open above the target.
    if (def.cluster && kind === 'bomb') {
      const h = o.pos.y - ctx.world.surfaceAt(o.pos.x, o.pos.z);
      if (h < (def.burstHeight ?? 220) && o.age > 0.6) {
        this._burstCluster(o, ctx);
        return;
      }
    }

    // Trails.
    o.trail -= dt;
    if (o.trail <= 0) {
      const near = o.pos.distanceToSquared(ctx.camera.position) < 4e6;
      o.trail = def.trailEvery ?? (near ? 0.016 : 0.05);
      if (kind === 'missile' && (o.fuel > 0 || o.age < 1)) ctx.fx.missileTrail(o.pos.x, o.pos.y, o.pos.z, o.vel.x, o.vel.y, o.vel.z, def.trailScale ?? 1, o.fuel > 0 ? 1 : 0);
      else if (kind === 'rocket' && o.fuel > 0) ctx.fx.rocketTrail(o.pos.x, o.pos.y, o.pos.z);
      else if (kind === 'cruise') ctx.fx.missileTrail(o.pos.x, o.pos.y, o.pos.z, o.vel.x, o.vel.y, o.vel.z, 1.4, 1);
      else if (def.napalm && Math.random() < 0.3) ctx.fx.rocketTrail(o.pos.x, o.pos.y, o.pos.z);
    }

    // Fuzes: proximity to the target, direct hit on anything, ground.
    if (o.age < (def.armTime ?? 0.25)) return;
    const prox = def.proximity ?? 8;
    if (o.target && o.target.alive && !o.decoy && o.pos.distanceToSquared(o.target.pos) < (prox + o.target.radius) ** 2) {
      this.detonate(o, o.target);
      return;
    }
    if (o.decoy && o.pos.distanceToSquared(o.decoy.pos) < 30 * 30) {
      this.detonate(o, null);
      return;
    }
    _v.copy(o.pos).sub(o.prevPos);
    const hitR = def.splash ? 2 : 1;
    this._hit = null;
    this._ctx = o;
    ctx.hash.query(o.pos.x - _v.x * 0.5, o.pos.y - _v.y * 0.5, o.pos.z - _v.z * 0.5, _v.length() * 0.5 + 40, this._visitHit, this);
    if (this._hit) {
      this.detonate(o, this._hit);
      return;
    }
    const ground = ctx.world.heightAt(o.pos.x, o.pos.z);
    const surface = Math.max(0, ground);
    if (o.pos.y <= surface + hitR) {
      o.pos.y = surface + 0.5;
      this.detonate(o, null, true, ground <= 0);
    }
  }

  _visitHit(u, self) {
    const o = self._ctx;
    if (!u.alive || u.team === o.team || u === o.owner) return;
    const r = u.radius + o.radius;
    const dx = o.pos.x - o.prevPos.x;
    const dy = o.pos.y - o.prevPos.y;
    const dz = o.pos.z - o.prevPos.z;
    if (segmentPointDist2(o.prevPos.x, o.prevPos.y, o.prevPos.z, dx, dy, dz, u.pos.x, u.pos.y, u.pos.z) < r * r) self._hit = u;
  }

  _turn(o, dir, maxAngle) {
    _v.set(0, 0, -1).applyQuaternion(o.quat);
    const cos = Math.max(-1, Math.min(1, _v.dot(dir)));
    const ang = Math.acos(cos);
    if (ang < 1e-5) return;
    _axis.crossVectors(_v, dir);
    if (_axis.lengthSq() < 1e-10) _axis.set(0, 1, 0).applyQuaternion(o.quat);
    _axis.normalize();
    _q.setFromAxisAngle(_axis, Math.min(ang, maxAngle));
    o.quat.premultiply(_q).normalize();
  }

  _burstCluster(o, ctx) {
    const def = o.def;
    const n = def.cluster;
    const sub = WEAPONS[def.bomblet] || def;
    for (let i = 0; i < n; i++) {
      _d.set(rand(-1, 1), rand(-0.6, 0.2), rand(-1, 1)).multiplyScalar(def.spread ?? 45).add(o.vel);
      const len = _d.length();
      _d.divideScalar(len);
      this.launch(sub, o.owner, null, o.pos, _d, len, { damage: sub.damage });
    }
    ctx.fx.explosion(o.pos.x, o.pos.y, o.pos.z, 6, { debris: false });
    ctx.audio?.explosion(o.pos, 6);
    this._release(o);
  }

  /** Blow up: direct damage to `hit`, splash around, effects. */
  detonate(o, hit, effects = true, water = false) {
    if (!o.alive) return;
    const s = this.s;
    const def = o.def;
    const p = o.pos;
    if (hit) s.combat.hit(hit, o.damage, o.owner, p.x, p.y, p.z, def);
    if (def.splash) s.combat.splash(p.x, p.y, p.z, def.splash, o.damage * (def.splashMult ?? 0.6), o.owner, o.team, def, hit);
    if (def.pierce && hit && o.hits < def.pierce) {
      o.hits++;
      return;
    }
    if (effects) {
      const size = def.blast ?? Math.max(6, (def.splash || 6) * 0.9);
      s.fx.explosion(p.x, p.y, p.z, size, { water, debris: !!hit });
      s.audio?.explosion(p, size);
      const d = p.distanceTo(s.camera.position);
      s.cameraRig.shake(Math.min(1, (size * 8) / Math.max(30, d)));
    }
    if (def.napalm) this.fireZone(p, def.napalm.radius, def.napalm.dps, def.napalm.life, o.owner, def);
    if (def.emp) s.emp(p, def.emp, o.owner);
    this._release(o);
  }

  _release(o) {
    if (o.target && !o.decoy) o.target.lockedBy = Math.max(0, o.target.lockedBy - 1);
    if (this.cruise === o) {
      this.cruise = null;
      this.s.onCruiseEnd?.();
    }
    o.alive = false;
    this.pool.release(o);
  }

  // ── Drones ───────────────────────────────────────────────────────────
  _drone(o, dt, ctx) {
    const def = o.def;
    const owner = o.owner;
    // Find a target near the owner.
    if (!o.target || !o.target.alive) {
      o.target = null;
      let best = def.range * def.range;
      const units = ctx.entities.units;
      for (let i = 0; i < units.length; i++) {
        const u = units[i];
        if (!u.alive || u.team === o.team || !u.isTarget || u.invulnerable) continue;
        const d2 = u.pos.distanceToSquared(o.pos);
        if (d2 < best) {
          best = d2;
          o.target = u;
        }
      }
    }
    let goal;
    if (o.target) {
      // Orbit the target at a firing distance.
      _v.copy(o.pos).sub(o.target.pos);
      _v.y = Math.abs(_v.y) * 0.3 + 60;
      _v.setLength(450);
      goal = _d.copy(o.target.pos).add(_v);
    } else if (owner && owner.active) {
      goal = _d.set(0, 12, 50).applyQuaternion(owner.quat).add(owner.pos);
    } else goal = _d.copy(o.pos);
    _v.copy(goal).sub(o.pos);
    const want = Math.min(def.speed, _v.length() * 1.5 + 40);
    _v.setLength(want);
    o.vel.lerp(_v, 1 - Math.exp(-2.5 * dt));
    o.pos.addScaledVector(o.vel, dt);
    const ground = ctx.world.surfaceAt(o.pos.x, o.pos.z) + 30;
    if (o.pos.y < ground) o.pos.y = ground;
    // Face the target (or travel direction) and shoot.
    if (o.target) _v.copy(o.target.pos).sub(o.pos).normalize();
    else _v.copy(o.vel).normalize();
    if (_v.lengthSq() > 0.5) {
      _m.lookAt(_d.set(0, 0, 0), _v.negate(), UP);
      o.quat.setFromRotationMatrix(_m);
    }
    o.droneFire -= dt;
    if (o.target && o.droneFire <= 0) {
      const dist = o.target.pos.distanceTo(o.pos);
      if (dist < 1200) {
        o.droneFire = def.fireInterval;
        _v.copy(o.target.pos).addScaledVector(o.target.vel, dist / 700).sub(o.pos).normalize();
        ctx.bullets.spawn(o.pos.x, o.pos.y, o.pos.z, _v.x * 700, _v.y * 700, _v.z * 700, 2, def.boltDamage, o.team, owner, 2, 3, def, 0);
        ctx.audio?.shot('plasma', o.pos);
      }
    }
  }

  // ── Decoys and fire zones ────────────────────────────────────────────
  _stepDecoys(dt) {
    const list = this.decoys.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      d.life -= dt;
      if (d.life <= 0) {
        // Missiles chasing it go ballistic.
        const ords = this.pool.active;
        for (let k = 0; k < ords.length; k++) {
          if (ords[k].decoy !== d) continue;
          ords[k].decoy = null;
          ords[k].target = null;
        }
        this.decoys.release(d);
        continue;
      }
      d.vel.y -= (d.type === 'flare' ? 6 : 2) * dt;
      d.vel.multiplyScalar(1 - (d.type === 'flare' ? 0.8 : 1.6) * dt);
      d.pos.addScaledVector(d.vel, dt);
      if (d.type === 'flare' && Math.random() < 0.6) this.s.fx.flareTrail(d.pos.x, d.pos.y, d.pos.z);
    }
  }

  _stepFires(dt, ctx) {
    const list = this.fires.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const f = list[i];
      f.life -= dt;
      if (f.life <= 0) {
        f.owner = null;
        this.fires.release(f);
        continue;
      }
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * f.radius;
        const x = f.pos.x + Math.cos(a) * r;
        const z = f.pos.z + Math.sin(a) * r;
        ctx.fx.groundFire(x, ctx.world.surfaceAt(x, z), z, 5);
      }
      f.tick -= dt;
      if (f.tick <= 0) {
        f.tick = 0.5;
        ctx.combat.splash(f.pos.x, f.pos.y, f.pos.z, f.radius, f.dps * 0.5, f.owner, f.team, f.def);
      }
    }
  }

  render(alpha, instanced, glows) {
    const list = this.pool.active;
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      o.renderPos.lerpVectors(o.prevPos, o.pos, alpha);
      o.renderQuat.slerpQuaternions(o.prevQuat, o.quat, alpha);
      if (o.def.model) instanced.add(o.def.model, o.renderPos, o.renderQuat, 1, null);
      if ((o.kind === 'missile' || o.kind === 'rocket' || o.kind === 'cruise') && o.fuel > 0) {
        _v.set(0, 0, 1.9).applyQuaternion(o.renderQuat).add(o.renderPos);
        glows.add(_v.x, _v.y, _v.z, o.def.glow ?? 2.4, 4, 2.4, 1.2, 0.7);
      } else if (o.kind === 'drone') glows.add(o.renderPos.x, o.renderPos.y, o.renderPos.z, 2, 1, 2.2, 4, 0.8);
    }
    const ds = this.decoys.active;
    for (let i = 0; i < ds.length; i++) {
      const d = ds[i];
      if (d.type === 'flare') glows.add(d.pos.x, d.pos.y, d.pos.z, 7 * Math.min(1, d.life), 5, 4.4, 3.2, 1.6);
    }
  }

  clear() {
    this.pool.releaseAll();
    this.decoys.releaseAll();
    while (this.fires.active.length) {
      const f = this.fires.active[0];
      f.owner = null;
      this.fires.release(f);
    }
    this.cruise = null;
  }
}
