// Generic object pool. Objects are created up front (or lazily up to `max`)
// and recycled; `acquire` never allocates once the pool is warm.

export class Pool {
  constructor(factory, { initial = 0, max = Infinity, reset, fifo = false } = {}) {
    this.factory = factory;
    this.fifo = fifo; // reuse the longest-freed object first (fewer stale references)
    this.reset = reset;
    this.max = max;
    this.free = [];
    this.active = [];
    this.created = 0;
    for (let i = 0; i < initial; i++) this.free.push(this._create());
  }

  _create() {
    this.created++;
    const o = this.factory(this.created - 1);
    o._poolIndex = -1;
    return o;
  }

  /** Returns a recycled object or null when the pool is exhausted. */
  acquire() {
    let o = this.fifo ? this.free.shift() : this.free.pop();
    if (!o) {
      if (this.created >= this.max) return null;
      o = this._create();
    }
    o._poolIndex = this.active.length;
    this.active.push(o);
    return o;
  }

  release(o) {
    const i = o._poolIndex;
    if (i < 0) return;
    const last = this.active.pop();
    if (last !== o) {
      this.active[i] = last;
      last._poolIndex = i;
    }
    o._poolIndex = -1;
    this.reset?.(o);
    this.free.push(o);
  }

  releaseAll() {
    while (this.active.length) this.release(this.active[this.active.length - 1]);
  }

  get count() {
    return this.active.length;
  }
}
