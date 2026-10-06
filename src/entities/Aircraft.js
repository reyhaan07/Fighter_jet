import * as THREE from 'three';
import { Unit } from './Unit.js';
import { FlightState, stepFlight } from './FlightModel.js';
import { clamp } from '../core/math.js';

// Any flying unit: player, wingmen, enemy fighters, bombers, drones and
// helicopters (helicopters use their own hover model, see Helicopter.js).
// A controller (player input or AI pilot) writes flight.controls and weapon
// triggers; the aircraft integrates physics and runs its weapons.

const _fwd = new THREE.Vector3();
const _tmp = new THREE.Vector3();

export class Aircraft extends Unit {
  constructor() {
    super();
    this.flight = new FlightState();
    this.stats = null;
    this.controller = null;
    this.loadout = null;
    this.isAir = true;
    this.kind = 'air';
    this.dying = 0;
    this.spin = 0;
    this.shield = 0;
    this.shieldActive = 0;
    this.flareTimer = 0;
    this.trigger = { gun: false, secondary: false, secondaryPressed: false, secondaryReleased: false, gunReleased: false, defense: false, flares: false };
    this.gunDir = new THREE.Vector3(0, 0, -1);
    this.target = null;
    this.isPlayer = false;
    this.isWingman = false;
    this.ecm = 0;
    this.smokeTimer = 0;
    this.dmgMult = 1;
    this.capsuleHalf = 6;
  }

  spawn(def, stats, team, x, y, z, yaw, speed) {
    this.baseSpawn(def, team, x, y, z);
    this.stats = stats;
    this.quat.setFromAxisAngle(_tmp.set(0, 1, 0), yaw);
    this.prevQuat.copy(this.quat);
    _fwd.set(0, 0, -1).applyQuaternion(this.quat);
    this.vel.copy(_fwd).multiplyScalar(speed);
    this.flight.reset(speed, 0.8);
    this.dying = 0;
    this.spin = 0;
    this.shield = 0;
    this.shieldActive = 0;
    this.flareTimer = 0;
    this.ecm = 0;
    this.target = null;
    this.controller = null;
    this.loadout = null;
    this.isPlayer = false;
    this.isWingman = false;
    this.smokeTimer = 0;
    this.dmgMult = 1;
    this.forceGun = false;
    this.kind = 'air';
    this.isAir = true;
    this.capsuleHalf = def.capsuleHalf ?? Math.max(2, def.radius * 0.7);
    if (def.paint !== undefined) this.paint.set(def.paint);
    else this.paint.set(0xffffff);
    const t = this.trigger;
    t.gun = t.secondary = t.secondaryPressed = t.secondaryReleased = t.gunReleased = t.defense = t.flares = false;
    return this;
  }

  get forward() {
    return _fwd.set(0, 0, -1).applyQuaternion(this.quat);
  }

  update(dt, ctx) {
    if (this.dying > 0) {
      this._updateDying(dt, ctx);
      return;
    }
    if (this.disabled > 0) {
      this.disabled -= dt;
      const c = this.flight.controls;
      c.pitch = -0.1;
      c.roll = 0.3;
      c.yaw = 0;
      c.ab = false;
      this.trigger.gun = this.trigger.secondary = false;
    } else if (this.controller) {
      this.controller.update(this, dt, ctx);
    }
    stepFlight(this, this.stats, dt, this.disabled > 0 ? 0.4 : 1);

    const f = this.flight;
    this.heat = clamp(0.35 + f.throttle * 0.35 + f.afterburner * 0.5, 0, 1.2);
    if (this.shieldActive > 0) this.shieldActive -= dt;
    if (this.ecm > 0) this.ecm -= dt;

    if (this.loadout && this.disabled <= 0) this.loadout.update(dt, ctx, this.trigger);

    // Damage smoke and fire.
    const hpf = this.hp / this.maxHp;
    if (hpf < 0.55) {
      this.smokeTimer -= dt;
      if (this.smokeTimer <= 0) {
        this.smokeTimer = hpf < 0.25 ? 0.03 : 0.06;
        ctx.fx.damageSmoke(this, hpf);
      }
    }

    // Terrain / sea collision.
    const ground = ctx.world.surfaceAt(this.pos.x, this.pos.z);
    if (this.pos.y < ground + 2.5) {
      this.pos.y = ground + 2.5;
      ctx.combat.kill(this, null, 'ground');
    }
    if (this.pos.y > 14000) this.vel.y = Math.min(this.vel.y, 0);
  }

  /** Burning, spinning fall after a kill; explodes on impact or after a timer. */
  startDying() {
    this.dying = 2.2 + Math.random() * 1.8;
    this.spin = (Math.random() < 0.5 ? -1 : 1) * (2 + Math.random() * 3);
    this.alive = false;
  }

  _updateDying(dt, ctx) {
    this.dying -= dt;
    const c = this.flight.controls;
    c.roll = Math.sign(this.spin);
    c.pitch = -0.4;
    c.yaw = 0.3;
    c.ab = false;
    this.flight.throttleTarget = 0;
    stepFlight(this, this.stats, dt, 0.6);
    this.vel.y -= 9.81 * dt * 0.8;
    this.smokeTimer -= dt;
    if (this.smokeTimer <= 0) {
      this.smokeTimer = 0.025;
      ctx.fx.burningTrail(this);
    }
    const ground = ctx.world.surfaceAt(this.pos.x, this.pos.z);
    if (this.dying <= 0 || this.pos.y < ground + 3) {
      this.pos.y = Math.max(this.pos.y, ground + 2);
      ctx.combat.finalExplosion(this);
    }
  }
}
