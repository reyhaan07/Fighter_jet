import * as THREE from 'three';

// Draws every non-player unit with InstancedMesh: one draw call per model per
// LOD level. Each frame units are bucketed by distance into LOD levels and
// frustum-culled with their bounding sphere. Matrices are written straight
// into the instance buffers (no allocation).

const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _sphere = new THREE.Sphere();
const _frustum = new THREE.Frustum();
const _pv = new THREE.Matrix4();
const _col = new THREE.Color();

class ModelBatch {
  constructor(key, levels, capacity, scene, castShadow) {
    this.key = key;
    this.levels = levels.map(({ geometry, material, dist }) => {
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _col.set(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false; // we cull per instance
      mesh.castShadow = castShadow && dist === levels[0].dist;
      mesh.receiveShadow = false;
      mesh.name = 'inst:' + key;
      scene.add(mesh);
      return { mesh, dist, count: 0 };
    });
    this.capacity = capacity;
    this.radius = levels[0].geometry.boundingSphere?.radius ?? 10;
  }
}

export class InstancedRenderer {
  constructor(scene, lodBias = 1, shadows = false) {
    this.scene = scene;
    this.lodBias = lodBias;
    this.shadows = shadows;
    this.batches = new Map();
    this.list = []; // same batches as an array (iteration without allocation)
    this.camPos = new THREE.Vector3();
    this.owned = [];
    this.visible = 0;
  }

  /**
   * levels: [{ geometry, material, dist }] ordered near → far. `dist` is the
   * maximum camera distance for that level (scaled by the quality lodBias).
   */
  register(key, levels, capacity = 64, own = true) {
    if (this.batches.has(key)) return this.batches.get(key);
    const b = new ModelBatch(key, levels, capacity, this.scene, this.shadows);
    this.batches.set(key, b);
    this.list.push(b);
    if (own) for (const l of levels) this.owned.push(l.geometry, l.material);
    return b;
  }

  begin(camera) {
    this.camPos.copy(camera.position);
    _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pv);
    this.visible = 0;
    for (let i = 0; i < this.list.length; i++) {
      const lv = this.list[i].levels;
      for (let j = 0; j < lv.length; j++) lv[j].count = 0;
    }
  }

  /** Queue one instance. color may be null (white). */
  add(key, pos, quat, scale, color) {
    const b = this.batches.get(key);
    if (!b) return;
    _sphere.center.copy(pos);
    _sphere.radius = b.radius * scale;
    if (!_frustum.intersectsSphere(_sphere)) return;
    const d = pos.distanceTo(this.camPos) / (this.lodBias * Math.max(scale, 0.5));
    const levels = b.levels;
    let lv = null;
    for (let i = 0; i < levels.length; i++) {
      if (d <= levels[i].dist) {
        lv = levels[i];
        break;
      }
    }
    if (!lv || lv.count >= b.capacity) return;
    _s.set(scale, scale, scale);
    _m.compose(pos, quat, _s);
    lv.mesh.setMatrixAt(lv.count, _m);
    if (color) lv.mesh.setColorAt(lv.count, color);
    else lv.mesh.setColorAt(lv.count, _col.set(1, 1, 1));
    lv.count++;
    this.visible++;
  }

  end() {
    for (let i = 0; i < this.list.length; i++) {
      const levels = this.list[i].levels;
      for (let j = 0; j < levels.length; j++) {
        const l = levels[j];
        const m = l.mesh;
        m.count = l.count;
        if (l.count) {
          m.instanceMatrix.clearUpdateRanges();
          m.instanceMatrix.addUpdateRange(0, l.count * 16);
          m.instanceMatrix.needsUpdate = true;
          m.instanceColor.clearUpdateRanges();
          m.instanceColor.addUpdateRange(0, l.count * 3);
          m.instanceColor.needsUpdate = true;
        }
      }
    }
  }

  dispose() {
    for (const b of this.batches.values()) {
      for (const l of b.levels) {
        this.scene.remove(l.mesh);
        l.mesh.dispose();
      }
    }
    const seen = new Set();
    for (const o of this.owned) {
      if (seen.has(o)) continue;
      seen.add(o);
      o.dispose();
    }
    this.batches.clear();
    this.list.length = 0;
    this.owned.length = 0;
  }
}
