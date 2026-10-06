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
const _q = new THREE.Quaternion();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

export class PlayerController {
  constructor(input, settings) {
    this.input = input;
    this.settings = settings;
    this.aimDir = new THREE.Vector3(0, 0, -1);
    this.manual = 0; // >0 while keyboard/stick flying overrides mouse aim
    this.mouseAim = settings.mouseAim;
    this.autoLevel = settings.autoLevel;
  }

  reset(u) {
    this.aimDir.set(0, 0, -1).applyQuaternion(u.quat);
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
    const thr = inp.axis('throttleDown', 'throttleUp');
    f.throttleTarget = clamp(f.throttleTarget + thr * dt * 0.7, 0, 1);
    c.ab = inp.down('afterburner') || (f.throttleTarget >= 1 && inp.value('throttleUp') > 0.5 && inp.lastDevice === 'gamepad');
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
    t.defense = inp.pressed('defense');
    t.flares = inp.down('flares');

    // Guns gimbal a few degrees toward the aim point (arcade assist).
    _fwd.set(0, 0, -1).applyQuaternion(u.quat);
    const cos = _fwd.dot(this.aimDir);
    const gimbal = 0.07;
    if (cos > Math.cos(gimbal)) u.gunDir.copy(this.aimDir);
    else u.gunDir.copy(_fwd).lerp(this.aimDir, Math.min(1, gimbal / Math.acos(clamp(cos, -1, 1)))).normalize();
  }
}
