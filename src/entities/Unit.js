import * as THREE from 'three';

// Base class for everything that can be targeted, hit and destroyed:
// aircraft, ground vehicles, ships, SAM sites and boss weak points.
// Instances are pooled by the EntityManager and re-initialised by spawn().

let NEXT_ID = 1;

export const TEAM = { FRIEND: 0, ENEMY: 1 };

export class Unit {
  constructor() {
    this.id = 0;
    this.pos = new THREE.Vector3();
    this.prevPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.prevQuat = new THREE.Quaternion();
    this.renderPos = new THREE.Vector3();
    this.renderQuat = new THREE.Quaternion();
    this.def = null;
    this.alive = false;
    this.active = false;
    this.team = TEAM.ENEMY;
    this.hp = 1;
    this.maxHp = 1;
    this.radius = 5;
    this.kind = 'ground'; // air | ground | sea | part
    this.isAir = false;
    this.heat = 0; // IR signature 0..1
    this.signature = 1; // radar signature multiplier
    this.parent = null;
    this.armored = false;
    this.disabled = 0; // seconds left disabled by EMP
    this.lastHitBy = null;
    this.lastHitTime = -10;
    this.lockedBy = 0; // number of missiles tracking this unit
    this.score = 100;
    this.credits = 50;
    this.isTarget = true; // shows in HUD / radar
    this.objective = null; // tag used by mission objectives
    this.renderKey = null;
    this.paint = new THREE.Color(1, 1, 1);
    this.hidden = false;
    this.renderScale = 1;
    this._hashStamp = 0;
    this._slot = -1;
  }

  baseSpawn(def, team, x, y, z) {
    this.id = NEXT_ID++;
    this.def = def;
    this.team = team;
    this.alive = true;
    this.active = true;
    this.maxHp = this.hp = def.hp;
    this.radius = def.radius;
    this.score = def.score ?? 100;
    this.credits = def.credits ?? 50;
    this.armored = !!def.armored;
    this.disabled = 0;
    this.lastHitBy = null;
    this.lastHitTime = -10;
    this.lockedBy = 0;
    this.parent = null;
    this.objective = null;
    this.isTarget = def.isTarget ?? true;
    this.signature = def.signature ?? 1;
    this.ghost = !!def.ghost; // not collidable (e.g. bomber gunners)
    // Optional capsule hitbox along the unit's forward axis (aircraft, ships).
    this.capsuleHalf = def.capsuleHalf || 0;
    this.capsuleRadius = def.capsuleRadius || this.radius * 0.5;
    this.renderKey = def.model;
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.quat.identity();
    this.prevQuat.identity();
  }

  /** Called before each simulation step so rendering can interpolate. */
  savePrev() {
    this.prevPos.copy(this.pos);
    this.prevQuat.copy(this.quat);
  }

  interpolate(alpha) {
    this.renderPos.lerpVectors(this.prevPos, this.pos, alpha);
    this.renderQuat.slerpQuaternions(this.prevQuat, this.quat, alpha);
  }

  /** Returns true when this hit killed the unit. Combat decides side effects. */
  applyDamage(amount) {
    if (!this.alive) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      return true;
    }
    return false;
  }
}
