import * as THREE from 'three';

// The player's selected target. "Next target" cycles hostiles ordered by how
// close they are to the centre of the view; with nothing selected the
// nearest hostile in front is picked automatically.

const _d = new THREE.Vector3();
const _f = new THREE.Vector3();

export class Targeting {
  constructor(session) {
    this.s = session;
    this.current = null;
    this._list = [];
    this._scores = [];
    this.autoTimer = 0;
  }

  _candidates(range) {
    const s = this.s;
    const p = s.player;
    const list = this._list;
    list.length = 0;
    const units = s.entities.units;
    _f.set(0, 0, -1).applyQuaternion(s.camera.quaternion);
    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (!u.alive || u.team === p.team || !u.isTarget) continue;
      _d.copy(u.pos).sub(p.pos);
      const dist = _d.length();
      if (dist > range) continue;
      u._tScore = _f.dot(_d) / dist - dist / (range * 4) + (u.objective ? 0.1 : 0);
      list.push(u);
    }
    list.sort((a, b) => b._tScore - a._tScore);
    return list;
  }

  next() {
    const list = this._candidates(this.s.player.stats.radarRange * 1.6);
    if (!list.length) {
      this.current = null;
      return;
    }
    const i = list.indexOf(this.current);
    this.current = list[(i + 1) % list.length];
    this._curId = this.current.id;
    this.s.audio?.click();
  }

  step(dt) {
    const p = this.s.player;
    // Dead, or its pooled object already reused for a different unit.
    if (this.current && (!this.current.alive || this.current.id !== this._curId)) this.current = null;
    this.autoTimer -= dt;
    if (!this.current && this.autoTimer <= 0) {
      this.autoTimer = 0.5;
      const list = this._candidates(p.stats.radarRange);
      if (list.length && list[0]._tScore > 0.5) this.current = list[0];
    }
    this._curId = this.current ? this.current.id : 0;
    p.target = this.current;
  }
}
