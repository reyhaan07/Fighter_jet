import * as THREE from 'three';
import { World } from '../world/World.js';
import { Aircraft } from '../entities/Aircraft.js';
import { PlayerController } from '../entities/PlayerController.js';
import { buildJet } from '../entities/models/jets.js';
import { ModelRegistry } from '../entities/models/registry.js';
import { InstancedRenderer } from '../entities/InstancedRenderer.js';
import { EntityManager } from '../entities/EntityManager.js';
import { AIDirector } from '../entities/ai/AIDirector.js';
import { Bullets } from '../entities/projectiles/Bullets.js';
import { Ordnance } from '../entities/projectiles/Ordnance.js';
import { EngineExhaust } from '../fx/EngineExhaust.js';
import { Effects } from '../fx/Effects.js';
import { SpatialHash } from '../core/SpatialHash.js';
import { Emitter } from '../core/events.js';
import { Loadout } from '../weapons/Loadout.js';
import { CameraRig } from './CameraRig.js';
import { Combat } from './Combat.js';
import { Warnings } from './Warnings.js';
import { Targeting } from './Targeting.js';
import { AIRCRAFT, PAINTS } from '../config/aircraft.js';
import { DIFFICULTY } from '../config/difficulty.js';
import { TEAM } from '../entities/Unit.js';
import { CMD } from '../entities/ai/brain.js';

// One running level: world, units, weapons, effects, camera and HUD.
// Created when a mission starts, fully disposed (GPU resources included)
// when it ends.

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const WING_CALLSIGNS = ['VIPER 2', 'VIPER 3'];

export class Session {
  /**
   * @param game    the Game
   * @param mission { id, env, start, loadout?, mode: ModeClass, ... }
   */
  constructor(game, mission) {
    this.game = game;
    this.mission = mission;
    this.time = 0;
    this.renderTime = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 1, game.quality.viewDistance * 1.15);
    this.scene.add(this.camera);
    this.events = new Emitter();
    this.difficulty = DIFFICULTY[mission.difficulty || game.settings.difficulty] || DIFFICULTY.normal;
    this.audio = game.audio || null;
    this.hud = game.hud;
    this.slowMo = 0;
    this.ended = false;
    this.paused = false;
    this.wingmen = [];
    this.score = 0;
    this.creditsEarned = 0;
    this.kills = 0;
    this.stats = { shots: 0, hits: 0, kills: 0, deaths: 0 };
  }

  async build() {
    const { game, scene, mission } = this;
    const q = game.quality;
    game.renderer.configure(q, scene, this.camera);
    const env = mission.env || {};
    this.world = new World(game.renderer.renderer, scene, q, env);
    this.mapHalf = (env.mapSize || 32000) / 2;

    this.hash = new SpatialHash({ cellSize: 250, buckets: 4096, capacity: 2048, largeRadius: 100 });
    this.instanced = new InstancedRenderer(scene, q.lodBias, q.shadows > 0);
    this.models = new ModelRegistry(this.instanced);
    this.models.lod0 = q.lod0;
    this.fx = new Effects(scene, q, this.world);
    this.bullets = new Bullets(4096);
    this.ordnance = new Ordnance(this);
    this.entities = new EntityManager(this);
    this.ai = new AIDirector(this);
    this.combat = new Combat(this);
    this.warnings = new Warnings(this);
    this.targeting = new Targeting(this);
    this.cameraRig = new CameraRig(this.camera);
    this.contrails = !!q.contrails;
    this.hud?.reset();

    // Context handed to units/weapons (the session itself carries everything).
    this.ctx = this;
    this.shake = (a) => this.cameraRig.shake(a);

    this._buildPlayer();
    this._wireEvents();

    // Game mode (campaign mission, survival, free flight).
    const Mode = mission.mode;
    this.mode = Mode ? new Mode(this, mission) : null;
    await this.mode?.setup?.();

    // Warm the pools and shaders so the first explosion doesn't hitch, and
    // render one frame while the loading screen is still up.
    for (const key of ['missile', 'missileBig', 'rocket', 'bomb', 'microMissile']) this.models.ensure(key);
    const r = game.renderer.renderer;
    if (r.compileAsync) await r.compileAsync(scene, this.camera);
    else r.compile(scene, this.camera);
    this.entities.interpolate(1);
    this.cameraRig.update(1 / 60, this.player, this.controller.aimDir, this.controller.usingMouseAim, null, this.anchors, this.player.flight.speed);
    game.renderer.render(0);
  }

  _buildPlayer() {
    const { game, scene, mission } = this;
    const q = game.quality;
    const save = game.save.data;
    const lo = mission.loadout || save.loadout;
    const stats = AIRCRAFT[lo.aircraft] || AIRCRAFT.viper;
    const paint = PAINTS[lo.paint]?.color ?? 0x4c535c;
    this.playerModel = buildJet(stats.design, { paint, callsign: game.settings.pilotName.slice(0, 8) });
    this.playerRig = new THREE.Group();
    this.playerRig.add(this.playerModel.group);
    this.exhaust = new EngineExhaust({ nozzles: this.playerModel.anchors.nozzles, radius: 0.44, light: q.lights > 0 });
    this.playerRig.add(this.exhaust.group);
    scene.add(this.playerRig);

    const player = (this.player = new Aircraft());
    const start = mission.start || { x: 0, z: 6000, alt: 1200, yaw: 0 };
    const ground = this.world.surfaceAt(start.x, start.z);
    player.spawn({ name: 'Player', hp: stats.hp, radius: stats.radius, model: null, isTarget: true, capsuleHalf: 7 }, stats, TEAM.FRIEND, start.x, Math.max(start.alt, ground + 400), start.z, start.yaw || 0, start.speed || 210);
    player.isPlayer = true;
    player.signature = stats.signature;
    this.controller = new PlayerController(game.input, game.settings);
    player.controller = this.controller;
    this.controller.reset(player);
    const slots = mission.slots || lo.slots;
    player.loadout = new Loadout(player, { ...slots, flares: 'flares' }, {
      upgrades: save.upgrades,
      ammoMult: stats.hardpointMult,
      infinite: !!mission.infiniteAmmo,
    });
    this.entities.add(player);
    this.anchors = { ...this.playerModel.anchors, camDistance: stats.camDistance };
  }

  spawnWingmen(n) {
    const p = this.player;
    for (let i = 0; i < n; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      _v.set(side * 70, -10, 60 + i * 30).applyQuaternion(p.quat).add(p.pos);
      const yaw = Math.atan2(-p.forward.x, -p.forward.z);
      const w = this.entities.spawnAir('fighter', TEAM.FRIEND, _v.x, _v.y, _v.z, yaw, { wingman: true, speed: p.flight.speed, skill: 0.25 });
      w.stats = { ...AIRCRAFT.viper, maxSpeed: 360 };
      w.hp = w.maxHp = 80;
      w.callsign = WING_CALLSIGNS[i] || `WING ${i + 2}`;
      w.isTarget = true;
      this.wingmen.push(w);
    }
  }

  commandWingmen(cmd) {
    const names = ['Covering you, lead.', 'Engaging your target!', 'Forming up on you.'];
    let any = false;
    for (const w of this.wingmen) {
      if (!w.alive) continue;
      w.controller.command = cmd;
      w.controller.commandTarget = cmd === CMD.ATTACK ? this.targeting.current : null;
      w.controller.timer = 0;
      any = true;
    }
    if (any) this.radio(this.wingmen[0].callsign, cmd === CMD.ATTACK && !this.targeting.current ? 'No target selected, lead.' : names[cmd]);
  }

  _wireEvents() {
    const ev = this.events;
    ev.on('hit', (u, dmg, src, x, y, z) => {
      if (src === this.player) {
        this.stats.hits++;
        this.hud?.hit(false);
        this.hud?.damageNumber(x, y + u.radius * 0.5, z, dmg, false);
        this.audio?.hitConfirm();
      }
      if (u === this.player) {
        this.hud?.damaged(dmg);
        this.cameraRig.shake(Math.min(0.5, dmg * 0.03));
        this.audio?.playerHit();
      }
    });
    ev.on('kill', (u, killer) => {
      if (u.team === TEAM.ENEMY) {
        const byPlayer = killer === this.player || killer?.owner === this.player;
        if (byPlayer || killer?.isWingman) {
          const mult = this.difficulty.reward;
          this.score += Math.round(u.score * mult);
          this.creditsEarned += Math.round(u.credits * mult);
        }
        if (byPlayer) {
          this.kills++;
          this.stats.kills++;
          this.hud?.hit(true);
          this.hud?.killFeed(`${u.def.name.toUpperCase()} DESTROYED  +${Math.round(u.score * this.difficulty.reward)}`);
          if (Math.random() < 0.35) this.radio('AWACS', ['Splash one!', 'Good kill!', 'Target destroyed.', 'Bandit down!'][(Math.random() * 4) | 0]);
          if (this.game.settings.killCam && u.isAir && u.kind === 'air' && Math.random() < 0.25 && this.cameraRig.mode === 'chase') {
            this.cameraRig.killCam(u.pos, 1.6);
            this.slowMo = Math.max(this.slowMo, 0.6);
          }
        } else if (killer?.isWingman) this.hud?.killFeed(`${killer.callsign}: ${u.def.name.toUpperCase()} DOWN`);
      }
      if (u === this.player) this._playerDown();
      if (u.isWingman) this.radio(u.callsign, "I'm hit! Ejecting!");
      this.mode?.onKill?.(u, killer);
    });
    ev.on('decoyed', (o) => {
      if (o.target === this.player || o.team === TEAM.ENEMY) this.hud?.message('MISSILE DECOYED', 1.2, '#7fd4ff');
    });
  }

  _playerDown() {
    this.stats.deaths++;
    this.cameraRig.killCam(this.player.pos, 3.5);
    this.hud?.message('YOU WERE SHOT DOWN', 4, '#ff5a4a');
    this.audio?.stopLoops();
    this.mode?.onPlayerDown?.();
  }

  radio(who, text, duration = 3.5, urgent = false) {
    this.hud?.radio(who, text, duration);
    this.audio?.radio(text, urgent);
  }

  /** EMP burst: disables enemy aircraft and defences in range. */
  emp(pos, def, owner) {
    this.fx.empWave(pos.x, pos.y, pos.z, def.radius);
    this.audio?.emp(pos);
    const units = this.entities.units;
    for (const u of units) {
      if (!u.alive || u.team === owner.team) continue;
      if (u.pos.distanceTo(pos) > def.radius) continue;
      u.disabled = Math.max(u.disabled, def.duration * (u.def.role === 'boss' ? 0.3 : 1));
      if (def.damage) this.combat.hit(u, def.damage, owner, u.pos.x, u.pos.y, u.pos.z, def);
    }
    // Fry missiles in flight.
    for (const o of this.ordnance.active) if (o.team !== owner.team && o.pos.distanceTo(pos) < def.radius) o.life = Math.min(o.life, 0.05);
    if (owner === this.player) this.game.renderer.setEffects(0, 0.8);
  }

  /** Terrain point under the aim (laser designator / CCIP). Reused vector. */
  groundAim() {
    const p = this.player;
    const dir = this.controller.usingMouseAim ? this.controller.aimDir : _d.set(0, 0, -1).applyQuaternion(p.quat);
    const out = (this._aim ||= new THREE.Vector3());
    let prev = 0;
    for (let t = 60; t < 16000; t += 60) {
      out.copy(p.pos).addScaledVector(dir, t);
      if (out.y <= this.world.surfaceAt(out.x, out.z)) {
        let a = prev;
        let b = t;
        for (let i = 0; i < 8; i++) {
          const m = (a + b) / 2;
          out.copy(p.pos).addScaledVector(dir, m);
          if (out.y <= this.world.surfaceAt(out.x, out.z)) b = m;
          else a = m;
        }
        out.copy(p.pos).addScaledVector(dir, b);
        return out;
      }
      prev = t;
    }
    return null;
  }

  /** Continuously computed impact point of a free-fall bomb (reused vector). */
  bombImpact() {
    const p = this.player;
    const out = (this._ccip ||= new THREE.Vector3());
    const v = (this._ccipV ||= new THREE.Vector3());
    out.copy(p.pos);
    v.copy(p.vel);
    for (let i = 0; i < 400; i++) {
      v.y -= 9.81 * 0.1;
      v.multiplyScalar(1 - 0.002);
      out.addScaledVector(v, 0.1);
      if (out.y <= this.world.surfaceAt(out.x, out.z)) return out;
    }
    return null;
  }

  spawnBomberTurrets(u, def) {
    for (const off of def.turrets) {
      _v.set(off[0], off[1], off[2]);
      this.entities.spawnGround('bomberTurret', u.team, u.pos.x, u.pos.z, 0, { parent: u, offset: _v, y: u.pos.y });
    }
  }

  onCruiseEnd() {
    this.cameraRig.killTimer = 0;
  }

  // ── Simulation ───────────────────────────────────────────────────────
  step(dt) {
    const input = this.game.input;
    input.beginStep();
    this.time += dt;
    this.fx.setTime(this.time);
    const p = this.player;

    if (input.pressed('camera')) this.cameraRig.cycle();
    if (input.pressedCode('F3')) this.game.perf?.toggle();
    if (input.pressed('radarZoom')) this.hud.radarRange = this.hud.radarRange >= 12000 ? 3000 : this.hud.radarRange * 2;
    if (p.alive) {
      if (input.pressed('nextTarget')) this.targeting.next();
      const lo = p.loadout;
      if (input.pressed('nextWeapon')) lo.next(1);
      if (input.pressed('prevWeapon')) lo.next(-1);
      if (input.pressed('slot1')) lo.select(0);
      if (input.pressed('slot2')) lo.select(1);
      if (input.pressed('slot3')) lo.select(2);
      if (input.pressed('wingAttack')) this.commandWingmen(CMD.ATTACK);
      if (input.pressed('wingCover')) this.commandWingmen(CMD.COVER);
      if (input.pressed('wingRegroup')) this.commandWingmen(CMD.REGROUP);
    }

    // Steerable cruise missile takes over the controls.
    const cm = this.ordnance.cruise;
    if (cm) {
      _d.set(0, 0, -1).applyQuaternion(cm.quat);
      const pitch = input.axis('pitchDown', 'pitchUp') * (this.game.settings.invertY ? -1 : 1);
      const yaw = input.axis('rollLeft', 'rollRight') + input.axis('yawLeft', 'yawRight');
      const [mx, my] = input.consumeMouse();
      const s = 0.0016 * this.game.settings.mouseSensitivity;
      _v.set(1, 0, 0).applyQuaternion(cm.quat);
      _d.addScaledVector(_v, (yaw * 0.9 * dt) + mx * s).addScaledVector(_v.set(0, 1, 0).applyQuaternion(cm.quat), pitch * 0.9 * dt - my * s);
      cm.guideDir.copy(_d.normalize());
      p.trigger.gun = false;
      if (input.pressed('fireSecondary') && cm.age > 0.5) this.ordnance.detonate(cm, null);
    }

    // Vapour cone around the fuselage near the sound barrier.
    const mach = p.flight.speed / 340;
    if (p.alive && mach > 0.94 && mach < 1.06 && this.contrails) {
      const fwd = p.forward;
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        _v.set(Math.cos(a) * 2.6, Math.sin(a) * 1.8, -1.5).applyQuaternion(p.quat).add(p.pos);
        this.fx.vapor(_v.x, _v.y, _v.z, p.vel.x - fwd.x * 30, p.vel.y - fwd.y * 30, p.vel.z - fwd.z * 30);
      }
    }
    // Wingtip vapour when pulling hard.
    if (p.alive && p.flight.gForce > 5.5 && (this._vapor = !this._vapor)) {
      for (const tip of this.anchors.wingtips) {
        _v.copy(tip).applyQuaternion(p.quat).add(p.pos);
        this.fx.vapor(_v.x, _v.y, _v.z, p.vel.x, p.vel.y, p.vel.z);
      }
    }

    this.targeting.step(dt);
    this.ai.step(dt);
    this.entities.step(dt, this);
    if (cm) p.trigger.secondary = p.trigger.secondaryPressed = false;
    this.bullets.step(dt, this);
    this.ordnance.step(dt, this);
    this.fx.step(dt);
    this.warnings.step(dt);
    this.mode?.step?.(dt);
    if (this.warnings.outOfBounds > 12 && p.alive) this.combat.hit(p, 20 * dt, null, p.pos.x, p.pos.y, p.pos.z);
  }

  // ── Rendering ────────────────────────────────────────────────────────
  render(dt, alpha) {
    const p = this.player;
    const loop = this.game.loop;
    this.renderTime = this.time + alpha * loop.step;
    if (!this.ordnance.cruise) this.controller.applyMouse();

    // Slow motion (kill cams, boss kills).
    if (this.slowMo > 0) {
      this.slowMo -= dt;
      loop.timeScale = this.slowMo > 0 ? 0.3 : 1;
    } else loop.timeScale = 1;

    this.entities.interpolate(alpha);
    this.playerRig.position.copy(p.renderPos);
    this.playerRig.quaternion.copy(p.renderQuat);
    this.playerRig.visible = p.active && (p.alive || p.dying > 0);
    this.exhaust.update(dt, this.renderTime, p.flight.throttle, p.flight.afterburner);

    const cm = this.ordnance.cruise;
    if (cm) {
      cm.renderPos.lerpVectors(cm.prevPos, cm.pos, alpha);
      cm.renderQuat.slerpQuaternions(cm.prevQuat, cm.quat, alpha);
      this.camera.position.copy(cm.renderPos).add(_v.set(0, 1.2, 4).applyQuaternion(cm.renderQuat));
      this.camera.quaternion.copy(cm.renderQuat);
      this.camera.updateMatrixWorld();
    } else {
      this.cameraRig.update(dt, p, this.controller.aimDir, this.controller.usingMouseAim, this.game.input, this.anchors, p.flight.speed);
    }

    this.instanced.begin(this.camera);
    this.fx.glows.begin();
    this.fx.beams.begin();
    this.entities.render(this.instanced, this.fx.glows, this.camera, this.fx.beams);
    this.ordnance.render(alpha, this.instanced, this.fx.glows);
    this.bullets.render(alpha, this.fx.beams, this.fx.glows);
    this.mode?.render?.(dt, alpha);
    this.fx.render(dt, this.renderTime);
    this.instanced.end();
    this.fx.glows.end();
    this.fx.beams.end();

    this.world.update(this.camera, this.renderTime, p.renderPos, p.flight.speed, this.game.renderer.pixelRatio);
    this._postFx(p);
    const blackout = Math.max(0, (p.flight.gForce - p.stats.maxG * 0.85) / (p.stats.maxG * 0.4));
    this._blackout = (this._blackout || 0) + (Math.min(0.8, blackout) - (this._blackout || 0)) * Math.min(1, dt * 2);
    this.game.renderer.setEffects(this._blackout, p.disabled > 0 ? 0.6 : 0);
    this.game.renderer.render(this.renderTime);
    this.hud?.draw(this, dt);
    this.audio?.update(this, dt);
  }

  /** Screen-space inputs for the sun shafts / lens flare and heat haze. */
  _postFx(p) {
    const r = this.game.renderer;
    const cam = this.camera;
    const sky = this.world.sky;
    const sunDir = sky.uniforms.uSunDir.value;
    _d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const facing = _d.dot(sunDir);
    _v.copy(cam.position).addScaledVector(sunDir, 1000).project(cam);
    const sx = _v.x * 0.5 + 0.5;
    const sy = _v.y * 0.5 + 0.5;
    const onScreen = facing > 0 && sunDir.y > -0.05 ? Math.max(0, 1 - Math.max(Math.abs(_v.x), Math.abs(_v.y)) * 0.6) : 0;
    const night = sky.uniforms.uMoon.value > 0.5;
    r.setSun(sx, sy, night ? onScreen * 0.25 : onScreen, sky.uniforms.uSunColor.value);
    // Heat haze behind the nozzles (not from the cockpit).
    const ex = this.exhaust;
    if (this.cameraRig.mode !== 'cockpit' && p.alive && ex.heatAnchor) {
      _v.copy(ex.heatAnchor).applyQuaternion(p.renderQuat).add(p.renderPos);
      const dist = _v.distanceTo(cam.position);
      _v.project(cam);
      _d.set(0, 0, 9 + p.flight.afterburner * 10).add(ex.heatAnchor).applyQuaternion(p.renderQuat).add(p.renderPos).project(cam);
      const amount = _v.z < 1 ? 0.35 + p.flight.throttle * 0.4 + p.flight.afterburner * 0.6 : 0;
      const speed = Math.max(0, (p.flight.speed - 230) / 170) * (this.cameraRig.mode === 'chase' ? 1 : 0.5);
      r.setHeat(_v.x * 0.5 + 0.5, _v.y * 0.5 + 0.5, _d.x * 0.5 + 0.5, _d.y * 0.5 + 0.5, Math.min(0.08, Math.max(0.004, 6 / dist)), amount, Math.min(1, speed) * (0.4 + p.flight.afterburner * 0.6));
    } else r.setHeat(0, 0, 0, 0, 0.01, 0, 0);
  }

  dispose() {
    this.mode?.dispose?.();
    this.ai.dispose();
    this.entities.clear();
    this.bullets.clear();
    this.ordnance.clear();
    this.world.dispose();
    this.playerModel.dispose();
    this.exhaust.dispose();
    this.fx.dispose();
    this.instanced.dispose();
    this.models.dispose();
    this.events.clear();
    this.audio?.stopLoops();
    this.scene.clear();
    this.hud?.clear();
  }
}
