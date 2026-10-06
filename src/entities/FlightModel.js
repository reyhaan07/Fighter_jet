import * as THREE from 'three';
import { G, clamp, smoothstep } from '../core/math.js';

// Arcade flight model shared by the player, wingmen and every AI aircraft.
// Easy to fly but convincing: G-limited pitch, speed-dependent control
// authority, energy bleed in turns, gravity on climbs/dives, stall at low
// speed with nose drop, airbrake and afterburner.

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _vdir = new THREE.Vector3();
const _local = new THREE.Vector3();
const _invQ = new THREE.Quaternion();
const _dq = new THREE.Quaternion();

export class FlightState {
  constructor() {
    this.throttle = 0.7; // actual engine setting 0..1
    this.throttleTarget = 0.7;
    this.afterburner = 0; // 0..1 spool
    this.angVel = new THREE.Vector3(); // local rad/s: x pitch, y yaw, z roll
    this.speed = 0;
    this.gForce = 1;
    this.stalled = false;
    this.aoa = 0;
    this.bank = 0;
    this.overG = 0;
    this.controls = { pitch: 0, roll: 0, yaw: 0, ab: false, brake: false };
  }
  reset(speed, throttle = 0.75) {
    this.throttle = this.throttleTarget = throttle;
    this.afterburner = 0;
    this.angVel.set(0, 0, 0);
    this.speed = speed;
    this.gForce = 1;
    this.stalled = false;
    const c = this.controls;
    c.pitch = c.roll = c.yaw = 0;
    c.ab = c.brake = false;
  }
}

export function stepFlight(u, stats, dt, mult = 1) {
  const f = u.flight;
  const c = f.controls;

  // Engine spool.
  const tt = clamp(f.throttleTarget, 0, 1);
  f.throttle += clamp(tt - f.throttle, -0.9 * dt, 0.9 * dt);
  f.afterburner += ((c.ab ? 1 : 0) - f.afterburner) * Math.min(1, dt * 4);

  _fwd.set(0, 0, -1).applyQuaternion(u.quat);
  _up.set(0, 1, 0).applyQuaternion(u.quat);
  _right.set(1, 0, 0).applyQuaternion(u.quat);

  let speed = u.vel.length();
  if (speed < 1) {
    u.vel.copy(_fwd).multiplyScalar(1);
    speed = 1;
  }
  _vdir.copy(u.vel).divideScalar(speed);

  // Control authority rises with dynamic pressure, saturates past corner speed.
  const eff = clamp(0.25 + 0.75 * (speed / stats.cornerSpeed), 0.25, 1.15) * mult;
  const lift = smoothstep(stats.stallSpeed * 0.75, stats.stallSpeed * 1.2, speed);
  f.stalled = lift < 0.6;
  const auth = 0.35 + 0.65 * lift;

  // G-limited pitch rate (turn rate = a / v).
  const gLimitRate = (stats.maxG * G) / Math.max(speed, 30);
  const pitchMax = Math.min(stats.pitchRate * eff, gLimitRate);
  const tx = c.pitch * pitchMax * auth * (c.pitch < 0 ? 0.7 : 1);
  const ty = -c.yaw * stats.yawRate * eff * auth;
  const tz = -c.roll * stats.rollRate * Math.min(eff, 1) * auth;
  const k = 1 - Math.exp(-stats.response * dt);
  const av = f.angVel;
  av.x += (tx - av.x) * k;
  av.y += (ty - av.y) * k;
  av.z += (tz - av.z) * k;

  // Weathervane: nose follows the airflow, strongly when stalled.
  _invQ.copy(u.quat).invert();
  _local.copy(_vdir).applyQuaternion(_invQ);
  const vane = (f.stalled ? 2.2 : 0.6) * dt;
  av.x += _local.y * vane * 2;
  av.y -= _local.x * vane * 2;
  if (f.stalled) av.x -= (1 - lift) * 0.9 * dt; // nose drop
  f.aoa = Math.atan2(-_local.y, -_local.z);

  // Integrate orientation in the body frame.
  _dq.set(av.x * dt * 0.5, av.y * dt * 0.5, av.z * dt * 0.5, 1).normalize();
  u.quat.multiply(_dq).normalize();
  _fwd.set(0, 0, -1).applyQuaternion(u.quat);
  _up.set(0, 1, 0).applyQuaternion(u.quat);

  // Longitudinal forces.
  const thrust = f.throttle * stats.thrust + f.afterburner * stats.abThrust;
  const dragK = (stats.thrust + stats.abThrust) / (stats.maxSpeed * stats.maxSpeed);
  const drag = dragK * speed * speed + (c.brake ? stats.brake * speed * speed * 0.01 + 8 : 0);
  const induced = stats.induced * Math.abs(av.x) * speed;
  speed += (thrust - drag - induced - G * _fwd.y) * dt;
  if (speed < 5) speed = 5;

  // Lift turns the velocity toward the nose; without lift we sink.
  const grip = 1 - Math.exp(-5.5 * lift * dt);
  _vdir.lerp(_fwd, grip).normalize();
  u.vel.copy(_vdir).multiplyScalar(speed);
  const sink = G * ((1 - lift) + lift * 0.3 * (1 - Math.abs(_up.y)));
  u.vel.y -= sink * dt;
  f.speed = u.vel.length();

  // Load factor felt by the pilot.
  const g = (av.x * speed) / G + _up.y;
  f.gForce += (g - f.gForce) * Math.min(1, dt * 8);
  f.bank = Math.atan2(-_right.set(1, 0, 0).applyQuaternion(u.quat).y, _up.y);

  u.pos.addScaledVector(u.vel, dt);
}

const _aimLocal = new THREE.Vector3();
const _r2 = new THREE.Vector3();

/**
 * Autopilot: converts a desired world direction into stick inputs. Used by
 * mouse-aim and every AI pilot. Writes pitch/roll/yaw into flight.controls.
 */
export function steerToward(u, dir, gain = 1, levelBias = 1) {
  const f = u.flight;
  const c = f.controls;
  _invQ.copy(u.quat).invert();
  _aimLocal.copy(dir).applyQuaternion(_invQ);
  const lz = -_aimLocal.z;
  const off = Math.acos(clamp(lz / Math.max(_aimLocal.length(), 1e-6), -1, 1));
  const pitchErr = Math.atan2(_aimLocal.y, lz);
  const yawErr = Math.atan2(_aimLocal.x, lz);
  const bankErr = Math.atan2(_aimLocal.x, _aimLocal.y);

  // Current bank angle relative to the horizon.
  _r2.set(1, 0, 0).applyQuaternion(u.quat);
  const upY = _up.set(0, 1, 0).applyQuaternion(u.quat).y;
  const bank = Math.atan2(-_r2.y, upY);

  const w = smoothstep(0.04, 0.32, off);
  const rollToTarget = clamp(bankErr * 2.2, -1, 1);
  const rollToLevel = clamp(-bank * 1.6 * levelBias, -1, 1);
  c.roll = clamp(rollToTarget * w + rollToLevel * (1 - w) - f.angVel.z * -0.12, -1, 1);
  c.pitch = clamp(pitchErr * 3.2 * gain - f.angVel.x * 0.25, -1, 1);
  if (w > 0.6 && Math.abs(bankErr) > 1.2) c.pitch = Math.max(c.pitch, 0.2); // roll first, then pull
  c.yaw = clamp(yawErr * 3 * gain, -1, 1) * (1 - w * 0.6);
  return off;
}
