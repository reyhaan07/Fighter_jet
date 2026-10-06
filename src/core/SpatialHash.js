// Allocation-free 3D spatial hash used for the collision broad-phase.
// Rebuilt every simulation step. Units are stored in a singly linked list per
// bucket (typed arrays), so inserting and querying never allocate.
// Very large units (carriers, the boss) go to a separate always-tested list.

const EMPTY = -1;

export class SpatialHash {
  constructor({ cellSize = 250, buckets = 4096, capacity = 1024, largeRadius = 120 } = {}) {
    this.cellSize = cellSize;
    this.inv = 1 / cellSize;
    this.mask = buckets - 1; // buckets must be a power of two
    this.head = new Int32Array(buckets).fill(EMPTY);
    this.next = new Int32Array(capacity);
    this.items = new Array(capacity);
    this.count = 0;
    this.large = [];
    this.largeRadius = largeRadius;
    this.stamp = 1;
  }

  _key(ix, iy, iz) {
    return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791)) & this.mask;
  }

  clear() {
    this.head.fill(EMPTY);
    this.count = 0;
    this.large.length = 0;
  }

  insert(unit) {
    if (unit.radius >= this.largeRadius) {
      this.large.push(unit);
      return;
    }
    if (this.count >= this.items.length) return;
    const p = unit.pos;
    const k = this._key(Math.floor(p.x * this.inv), Math.floor(p.y * this.inv), Math.floor(p.z * this.inv));
    const i = this.count++;
    this.items[i] = unit;
    this.next[i] = this.head[k];
    this.head[k] = i;
  }

  /**
   * Calls fn(unit, ctx) for every unit whose cell overlaps the sphere (x,y,z,r).
   * Each unit is visited at most once per query. Return true from fn to stop.
   */
  query(x, y, z, r, fn, ctx) {
    const stamp = ++this.stamp;
    const inv = this.inv;
    const x0 = Math.floor((x - r) * inv), x1 = Math.floor((x + r) * inv);
    const y0 = Math.floor((y - r) * inv), y1 = Math.floor((y + r) * inv);
    const z0 = Math.floor((z - r) * inv), z1 = Math.floor((z + r) * inv);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iy = y0; iy <= y1; iy++) {
        for (let iz = z0; iz <= z1; iz++) {
          let i = this.head[this._key(ix, iy, iz)];
          while (i !== EMPTY) {
            const u = this.items[i];
            if (u._hashStamp !== stamp) {
              u._hashStamp = stamp;
              if (fn(u, ctx) === true) return;
            }
            i = this.next[i];
          }
        }
      }
    }
    for (let j = 0; j < this.large.length; j++) {
      const u = this.large[j];
      if (u._hashStamp !== stamp) {
        u._hashStamp = stamp;
        if (fn(u, ctx) === true) return;
      }
    }
  }
}
