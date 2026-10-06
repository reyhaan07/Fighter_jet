import * as THREE from 'three';
import { steerToward } from './FlightModel.js';
import { clamp } from '../core/math.js';

// Turns player input into flight controls and weapon triggers.
//
// Mouse-aim mode (default): the mouse moves an aim direction; the autopilot
// flies the nose toward it. Arrow keys / stick fly the jet directly and take
// over the axis they touch (the aim then follows the nose so nothing snaps).
// Direct mode: keyboard / gamepad only, with optional auto-level.

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _lead = new THREE.Vector3();
const _q = new THREE.Quaternion();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class PlayerController {
  constructor(input, settings) {
    this.input = input;
    this.settings = settings;
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this._aim = new THREE.Vector3();
    this.manual = 0; // >0 while keyboard/stick flying overrides mouse aim
    this.mouseAim = settings.mouseAim;
    this.abDetent = false; // afterburner engaged via the throttle detent (mouse wheel)
    this.gStress = 0; // accumulated high-G load on the pilot (G-LOC at 3)
    this.gloc = 0; // seconds left unconscious after G-LOC
    this.vision = 0; // 0..1 tunnel vision / blackout for the screen
    this.redout = 0; // 0..1 negative-G redout
    this.autoLevel = settings.autoLevel;
  }

  /**
   * Human limits on top of the airframe's: sustained G above ~7.5 builds up
   * until the pilot greys out and then loses consciousness (G-LOC) for a few
   * seconds, hands off the stick. Strong negative G causes a redout.
   */
  afterUpdate(u, dt) {
    const g = u.flight.gForce;
    if (this.gloc > 0) {
      this.gloc -= dt;
      const c = u.flight.controls;
      c.pitch = c.roll = c.yaw = 0;
      c.ab = c.brake = false;
      u.trigger.gun = u.trigger.secondary = u.trigger.secondaryPressed = false;
      if (this.gloc <= 0) this.gStress = 1.6; // waking up groggy
    } else if (g > 7.5) {
      this.gStress += (g - 7.5) * 0.35 * dt;
      if (this.gStress >= 3) this.gloc = 3;
    } else {
      this.gStress = Math.max(0, this.gStress - (g < 4 ? 0.9 : 0.4) * dt);
    }
    const tunnel = clamp((g - 6) / 6, 0, 0.4);
    const target = this.gloc > 0 ? 1 : Math.max(tunnel, Math.min(0.95, this.gStress / 3));
    this.vision += (target - this.vision) * Math.min(1, dt * (this.gloc > 0 ? 3 : 2));
    const red = clamp((-g - 2) / 2.5, 0, 0.85);
    this.redout += (red - this.redout) * Math.min(1, dt * 2);
  }

  reset(u) {
    this.aimDir.set(0, 0, -1).applyQuaternion(u.quat);
    this.abDetent = false;
    this.gStress = this.gloc = this.vision = this.redout = 0;
    this.manual = 0;
  }

  get usingMouseAim() {
    return this.mouseAim && this.input.lastDevice !== 'gamepad';
  }

  /** Mouse look is applied per rendered frame so aiming is never quantised. */
  applyMouse() {
    const [dx, dy] = this.input.consumeMouse();
    if (!this.usingMouseAim || (dx === 0 && dy === 0)) return;
    const s = 0.0022 * this.settings.mouseSensitivity;
    const inv = this.settings.invertY ? -1 : 1;
    // Yaw around world up, pitch around the aim's right vector.
    _q.setFromAxisAngle(AXIS_Y, -dx * s);
    this.aimDir.applyQuaternion(_q);
    _right.crossVectors(this.aimDir, AXIS_Y).normalize();
    const pitch = Math.asin(clamp(this.aimDir.y, -1, 1));
    const dp = clamp(-dy * s * inv, -1.45 - pitch, 1.45 - pitch);
    _q.setFromAxisAngle(_right, dp);
    this.aimDir.applyQuaternion(_q).normalize();
  }

  update(u, dt) {
    const inp = this.input;
    const c = u.flight.controls;
    const f = u.flight;
    if (inp.pressed('mouseAim')) {
      this.mouseAim = !this.mouseAim;
      this.settings.mouseAim = this.mouseAim;
      this.reset(u);
    }
    if (inp.pressed('autoLevel')) {
      this.autoLevel = !this.autoLevel;
      this.settings.autoLevel = this.autoLevel;
    }

    const inv = this.settings.invertY ? -1 : 1;
    const kPitch = inp.axis('pitchDown', 'pitchUp') * inv;
    const kRoll = inp.axis('rollLeft', 'rollRight');
    const kYaw = inp.axis('yawLeft', 'yawRight');

    if (this.usingMouseAim) {
      steerToward(u, this.aimDir, 1, this.autoLevel ? 1 : 0.35);
      const manual = Math.abs(kPitch) > 0.05 || Math.abs(kRoll) > 0.05;
      if (Math.abs(kPitch) > 0.05) c.pitch = kPitch;
      if (Math.abs(kRoll) > 0.05) c.roll = kRoll;
      if (Math.abs(kYaw) > 0.05) c.yaw = kYaw;
      if (manual) this.manual = 0.35;
      if (this.manual > 0) {
        // While flying by keys the aim rides just ahead of the nose.
        this.manual -= dt;
        _fwd.set(0, 0, -1).applyQuaternion(u.quat);
        this.aimDir.lerp(_fwd, 1 - Math.exp(-12 * dt)).normalize();
      }
    } else {
      c.pitch = kPitch;
      c.roll = kRoll;
      c.yaw = kYaw;
      if (this.autoLevel && Math.abs(kRoll) < 0.05 && Math.abs(f.bank) < 1.4) {
        c.roll = clamp(-f.bank * 1.4 - f.angVel.z * -0.1, -0.6, 0.6);
      }
      _fwd.set(0, 0, -1).applyQuaternion(u.quat);
      this.aimDir.copy(_fwd);
    }

    // Throttle: W/S (or triggers) move the setting; afterburner past 100 %.
    // Mouse wheel: 5 % per notch; one notch past 100 % engages the afterburner
    // detent, a notch down drops back out of it, like a real throttle quadrant.
    const thr = inp.axis('throttleDown', 'throttleUp');
    const b = inp.bindings;
    const wheel = inp.consumeWheel();
    let notches = 0;
    if (wheel > 0 && b.throttleUp.includes('WheelUp')) notches = wheel;
    else if (wheel < 0 && b.throttleDown.includes('WheelDown')) notches = wheel;
    for (; notches > 0; notches--) {
      if (f.throttleTarget >= 0.999) this.abDetent = true;
      f.throttleTarget = Math.min(1, Math.round(f.throttleTarget * 20 + 1) / 20);
    }
    for (; notches < 0; notches++) {
      if (this.abDetent) this.abDetent = false;
      else f.throttleTarget = Math.max(0, Math.round(f.throttleTarget * 20 - 1) / 20);
    }
    f.throttleTarget = clamp(f.throttleTarget + thr * dt * 0.7, 0, 1);
    if (thr < 0) this.abDetent = false;
    // On-screen throttle slider: the top notch past 100 % is the afterburner.
    if (inp.touchThrottle >= 0) {
      f.throttleTarget = Math.min(1, inp.touchThrottle);
      this.abDetent = inp.touchThrottle > 1.001;
      inp.touchThrottle = -1;
    }
    if (f.throttleTarget < 1) this.abDetent = false;
    c.ab = this.abDetent || inp.down('afterburner') || (f.throttleTarget >= 1 && inp.value('throttleUp') > 0.5 && inp.lastDevice === 'gamepad');
    c.brake = inp.down('airbrake');

    // Weapon triggers.
    const t = u.trigger;
    const gun = inp.down('fireGun');
    t.gunReleased = t.gun && !gun;
    t.gun = gun;
    const sec = inp.down('fireSecondary');
    t.secondaryPressed = inp.pressed('fireSecondary');
    t.secondaryReleased = t.secondary && !sec;
    t.secondary = sec;
    // While steering a cruise missile (and the step it detonates) the fire
    // buttons belong to the missile, not the jet's weapons.
    if (this.holdFire) t.gun = t.secondary = t.secondaryPressed = false;
    t.defense = inp.pressed('defense');
    t.flares = inp.down('flares');

    // Guns gimbal a few degrees toward the aim point (arcade assist). If the
    // selected air target's lead point is close to the aim, the guns aim there.
    _fwd.set(0, 0, -1).applyQuaternion(u.quat);
    const aim = this._aim.copy(this.aimDir);
    const tg = u.target;
    if (tg && tg.alive && tg.isAir && u.loadout?.gun?.def.speed) {
      const dist = tg.pos.distanceTo(u.pos);
      if (dist < 2000) {
        const tt = dist / u.loadout.gun.def.speed;
        _lead.copy(tg.pos).addScaledVector(tg.vel, tt).addScaledVector(u.vel, -tt).sub(u.pos).normalize();
        if (_lead.dot(aim) > Math.cos(0.09)) aim.copy(_lead);
      }
    }
    const cos = _fwd.dot(aim);
    const gimbal = 0.07;
    if (cos > Math.cos(gimbal)) u.gunDir.copy(aim);
    else u.gunDir.copy(_fwd).lerp(aim, Math.min(1, gimbal / Math.acos(clamp(cos, -1, 1)))).normalize();
  }
}
