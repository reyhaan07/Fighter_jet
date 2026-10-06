import { buildJetGeometry, createJetInstanceMaterial } from './jets.js';
import { UNIT_MODELS, createUnitMaterial } from './units.js';

// Lazily registers instanced models with the InstancedRenderer the first
// time a unit of that type is spawned. Keys:
//   jet:<design>   procedural jets (3 LODs)
//   <unit model>   ground units, ships, bombers, helicopters, ordnance (see units.js)

export class ModelRegistry {
  constructor(instanced) {
    this.instanced = instanced;
    this.jetMaterial = null;
    this.unitMaterial = null;
    this.capacity = { 'jet:viper': 96, 'jet:lancer': 96, 'jet:drone': 96 };
    this.anchors = {}; // per jet model: nozzles, wingtips, ... (for plumes and nav lights)
    this.lod0 = 0;
  }

  ensure(key) {
    if (!key || this.instanced.batches.has(key)) return;
    if (key.startsWith('jet:')) {
      const design = key.slice(4);
      this.jetMaterial ||= createJetInstanceMaterial();
      const mid = buildJetGeometry(design, 1);
      this.anchors[key] = mid.anchors;
      const levels = [
        { geometry: mid.geometry, material: this.jetMaterial, dist: 450 },
        { geometry: buildJetGeometry(design, 2).geometry, material: this.jetMaterial, dist: 30000 },
      ];
      // Full-detail model up close on High/Ultra.
      if (this.lod0) levels.unshift({ geometry: buildJetGeometry(design, 0).geometry, material: this.jetMaterial, dist: this.lod0 });
      this.instanced.register(key, levels, this.capacity[key] || 48, false);
      this._own(levels);
      return;
    }
    const build = UNIT_MODELS[key];
    if (!build) throw new Error('Unknown model ' + key);
    this.unitMaterial ||= createUnitMaterial();
    const lods = build();
    const levels = lods.map((l) => ({ geometry: l.geometry, material: l.material || this.unitMaterial, dist: l.dist }));
    this.instanced.register(key, levels, lods.capacity || 64, false);
    this._own(levels);
  }

  _own(levels) {
    for (const l of levels) {
      this.instanced.owned.push(l.geometry);
      if (l.material !== this.jetMaterial && l.material !== this.unitMaterial) this.instanced.owned.push(l.material);
    }
  }

  dispose() {
    this.jetMaterial?.dispose();
    this.unitMaterial?.dispose();
  }
}

