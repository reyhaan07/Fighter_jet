import * as THREE from 'three';
import { clamp, damp } from '../core/math.js';

// Chase, cockpit and cinematic kill-cam views (C cycles). Runs per rendered
// frame on interpolated transforms so the camera is always smooth.

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _up = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const WORLD_UP = new THREE.Vector3(0, 1, 0);

export const CAMERA_MODES = ['chase', 'cockpit', 'cinematic'];

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.trauma = 0;
    this.shakeTime = 0;
    this.killTarget = null;
    this.killPos = new THREE.Vector3();
    this.killTimer = 0;
    this.orbit = 0;
    this.baseFov = 68;
    this.initialized = false;
    this.camUp = new THREE.Vector3(0, 1, 0);
  }

  cycle() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.mode = CAMERA_MODES[(i + 1) % CAMERA_MODES.length];
    this.killTimer = 0;
  }

  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  /** Brief cinematic view of a kill (pos is copied). */
  killCam(pos, duration = 2.2) {
    this.killPos.copy(pos);
    this.killTimer = duration;
    this.orbit = Math.random() * Math.PI * 2;
  }

  update(dt, player, aimDir, mouseAim, input, anchors, speed) {
    const cam = this.camera;
    const p = player.renderPos;
    const q = player.renderQuat;

    // Free look (right stick / numpad), springs back when released.
    const lx = input ? input.axis('lookLeft', 'lookRight') : 0;
    const ly = input ? input.axis('lookDown', 'lookUp') : 0;
    this.lookYaw = damp(this.lookYaw, -lx * 2.4, 6, dt);
    this.lookPitch = damp(this.lookPitch, ly * 1.2, 6, dt);

    let mode = this.mode;
    if (this.killTimer > 0) {
      this.killTimer -= dt;
      mode = 'kill';
    }

    if (mode === 'chase') {
      const dist = anchors.camDistance;
      if (mouseAim) {
        // Camera looks along the aim direction; horizon stays level.
        _v.copy(aimDir);
        if (this.lookYaw || this.lookPitch) {
          _q.setFromAxisAngle(WORLD_UP, this.lookYaw);
          _v.applyQuaternion(_q);
        }
        const target = _v2.copy(p).addScaledVector(_v, -dist).addScaledVector(WORLD_UP, dist * 0.22);
        if (!this.initialized) this.pos.copy(target);
        this.pos.lerp(target, 1 - Math.exp(-30 * dt));
        _v2.copy(p).addScaledVector(_v, 400);
        _m.lookAt(this.pos, _v2, WORLD_UP);
        this.quat.setFromRotationMatrix(_m);
      } else {
        // Classic chase: rides behind the jet and banks with it.
        _up.set(0, 1, 0).applyQuaternion(q);
        this.camUp.lerp(_up, 1 - Math.exp(-5 * dt)).normalize();
        _v.set(0, 0, -1).applyQuaternion(q);
        _e.set(this.lookPitch, this.lookYaw, 0);
        _q.setFromEuler(_e);
        _v.applyQuaternion(_q);
        const target = _v2.copy(p).addScaledVector(_v, -dist).addScaledVector(this.camUp, dist * 0.2);
        if (!this.initialized) this.pos.copy(target);
        this.pos.lerp(target, 1 - Math.exp(-12 * dt));
        _v2.copy(p).addScaledVector(_v, 300).addScaledVector(this.camUp, 4);
        _m.lookAt(this.pos, _v2, this.camUp);
        this.quat.setFromRotationMatrix(_m);
      }
    } else if (mode === 'cockpit') {
      this.pos.copy(anchors.cockpit).applyQuaternion(q).add(p);
      _e.set(this.lookPitch, this.lookYaw, 0);
      _q.setFromEuler(_e);
      this.quat.copy(q).multiply(_q);
    } else if (mode === 'cinematic') {
      // Slow orbit at a distance, like an air-show camera.
      this.orbit += dt * 0.18;
      const r = anchors.camDistance * 2.2;
      _v.set(Math.cos(this.orbit) * r, r * 0.25 + Math.sin(this.orbit * 0.6) * r * 0.2, Math.sin(this.orbit) * r);
      const target = _v2.copy(p).add(_v);
      if (!this.initialized) this.pos.copy(target);
      this.pos.lerp(target, 1 - Math.exp(-4 * dt));
      _m.lookAt(this.pos, p, WORLD_UP);
      this.quat.setFromRotationMatrix(_m);
    } else if (mode === 'kill') {
      this.orbit += dt * 0.6;
      const r = 70;
      _v.set(Math.cos(this.orbit) * r, 22, Math.sin(this.orbit) * r);
      this.pos.copy(this.killPos).add(_v);
      _m.lookAt(this.pos, this.killPos, WORLD_UP);
      this.quat.setFromRotationMatrix(_m);
    }
    this.initialized = true;

    cam.position.copy(this.pos);
    cam.quaternion.copy(this.quat);

    // Shake: trauma² for a natural falloff.
    this.trauma = Math.max(0, this.trauma - dt * 1.3);
    this.shakeTime += dt;
    if (this.trauma > 0) {
      const s = this.trauma * this.trauma;
      const t = this.shakeTime * 32;
      _e.set(Math.sin(t * 1.1) * 0.03 * s, Math.sin(t * 0.9 + 1.7) * 0.03 * s, Math.sin(t * 1.3 + 3.1) * 0.05 * s);
      _q.setFromEuler(_e);
      cam.quaternion.multiply(_q);
    }

    // FOV opens up with speed.
    const fov = this.baseFov + clamp((speed - 150) / 250, 0, 1) * 10 + (mode === 'cockpit' ? 6 : 0);
    if (Math.abs(cam.fov - fov) > 0.05) {
      cam.fov = damp(cam.fov, fov, 3, dt);
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
  }
}
