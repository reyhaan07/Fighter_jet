import * as THREE from 'three';
import { World } from '../world/World.js';
import { Aircraft } from '../entities/Aircraft.js';
import { PlayerController } from '../entities/PlayerController.js';
import { buildJet } from '../entities/models/jets.js';
import { EngineExhaust } from '../fx/EngineExhaust.js';
import { CameraRig } from './CameraRig.js';
import { AIRCRAFT, PAINTS } from '../config/aircraft.js';
import { TEAM } from '../entities/Unit.js';

// One running level: world, units, weapons, effects, camera and HUD.
// Created when a mission starts and fully disposed when it ends.

export class Session {
  constructor(game, mission) {
    this.game = game;
    this.mission = mission;
    this.time = 0;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, 1, 1, game.quality.viewDistance * 1.15);
    this.scene.add(this.camera);
  }

  async build() {
    const { game, scene, mission } = this;
    const q = game.quality;
    game.renderer.configure(q, scene, this.camera);
    this.world = new World(game.renderer.renderer, scene, q, mission.env || {});

    // Player aircraft.
    const save = game.save.data;
    const lo = mission.loadout || save.loadout;
    const stats = AIRCRAFT[lo.aircraft];
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
    player.spawn({ hp: stats.hp, radius: stats.radius, model: null, isTarget: false, capsuleHalf: 7 }, stats, TEAM.FRIEND, start.x, Math.max(start.alt, ground + 400), start.z, start.yaw, 200);
    player.isPlayer = true;
    this.controller = new PlayerController(game.input, game.settings);
    player.controller = this.controller;
    this.controller.reset(player);
    this.anchors = { ...this.playerModel.anchors, camDistance: stats.camDistance };

    this.cameraRig = new CameraRig(this.camera);

    // Stub context so the aircraft can run before combat systems exist.
    this.ctx = {
      world: this.world,
      fx: { damageSmoke() {}, burningTrail() {} },
      combat: { kill: () => {}, finalExplosion: () => {} },
    };

    game.renderer.renderer.compile(scene, this.camera);
  }

  step(dt) {
    const input = this.game.input;
    input.beginStep();
    this.time += dt;
    const p = this.player;
    p.savePrev();
    if (input.pressed('camera')) this.cameraRig.cycle();
    p.update(dt, this.ctx);
  }

  render(dt, alpha) {
    const p = this.player;
    this.controller.applyMouse();
    p.interpolate(alpha);
    this.playerRig.position.copy(p.renderPos);
    this.playerRig.quaternion.copy(p.renderQuat);
    this.exhaust.update(dt, this.time, p.flight.throttle, p.flight.afterburner);
    this.cameraRig.update(dt, p, this.controller.aimDir, this.controller.usingMouseAim, this.game.input, this.anchors, p.flight.speed);
    this.playerRig.visible = this.cameraRig.mode !== 'cockpit' || true;
    this.world.update(this.camera, this.time, p.renderPos);
    this.game.renderer.render(this.time);
    this.game.hud?.draw(this, dt);
  }

  dispose() {
    this.world.dispose();
    this.playerModel.dispose();
    this.exhaust.dispose();
    this.scene.clear();
  }
}
