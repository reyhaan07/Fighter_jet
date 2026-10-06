// Radar-warning receiver for the player: who is locking us, which missiles
// are inbound, plus flight warnings (stall, terrain, out of area).

export class Warnings {
  constructor(session) {
    this.s = session;
    this.lockLevel = 0; // 0..1 strongest enemy lock this step
    this.lockSource = null;
    this.samLevel = 0;
    this.incoming = []; // missiles targeting the player (reused array)
    this.nearestMissile = Infinity;
    this.stall = false;
    this.pullUp = false;
    this.outOfBounds = 0;
    this._lock = 0;
    this._sam = 0;
  }

  locking(source, progress) {
    if (progress > this._lock) {
      this._lock = progress;
      this.lockSource = source;
    }
  }

  samTrack(site, progress) {
    if (progress > this._sam) this._sam = Math.min(1, progress);
  }

  launch(missile) {
    if (missile) this.s.radio('warn', missile.def.seeker === 'ir' ? 'Fox two! Missile inbound!' : 'Missile launch! Break, break!', 2.5, true);
  }

  step(dt) {
    const s = this.s;
    const p = s.player;
    this.lockLevel = Math.max(this._lock, this._sam);
    this.samLevel = this._sam;
    this._lock = this._sam = 0;
    this.incoming.length = 0;
    this.nearestMissile = Infinity;
    if (!p || !p.alive) return;
    const ord = s.ordnance.active;
    for (let i = 0; i < ord.length; i++) {
      const o = ord[i];
      if (o.target !== p || o.decoy || o.kind !== 'missile') continue;
      this.incoming.push(o);
      const d = o.pos.distanceTo(p.pos);
      if (d < this.nearestMissile) this.nearestMissile = d;
    }
    const f = p.flight;
    this.stall = f.stalled;
    const ground = s.world.surfaceAt(p.pos.x + p.vel.x * 4, p.pos.z + p.vel.z * 4);
    this.pullUp = p.vel.y < -20 && p.pos.y - ground < -p.vel.y * 6;
    const lim = s.mapHalf * 0.82;
    if (Math.abs(p.pos.x) > lim || Math.abs(p.pos.z) > lim) this.outOfBounds += dt;
    else this.outOfBounds = 0;
  }
}
