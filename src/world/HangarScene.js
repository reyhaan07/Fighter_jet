import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildJet } from '../entities/models/jets.js';
import { EngineExhaust } from '../fx/EngineExhaust.js';

// Main-menu / hangar backdrop: the portfolio's structural hangar (steel
// frames, light strips, grid floor) with the selected jet idling on the
// centre line and a slow orbiting camera.

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(255,190,120,0.55)';
  g.lineWidth = 2;
  g.strokeRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(150,180,210,0.18)';
  g.lineWidth = 1;
  for (let i = 1; i < 8; i++) {
    g.beginPath();
    g.moveTo(i * 32, 0);
    g.lineTo(i * 32, 256);
    g.moveTo(0, i * 32);
    g.lineTo(256, i * 32);
    g.stroke();
  }
  g.fillStyle = 'rgba(255,200,140,0.8)';
  g.fillRect(124, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class HangarScene {
  constructor(game) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05070b);
    this.scene.fog = new THREE.Fog(0x05070b, 60, 220);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 600);
    this.time = 0;
    this.orbit = 0.6;
    this.disposables = [];
    const track = (x) => (this.disposables.push(x), x);

    const r = game.renderer.renderer;
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envRT = pmrem.fromScene(room, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.35;
    room.dispose?.();
    pmrem.dispose();

    // Structure: repeated steel frames with light strips.
    const W = 21;
    const FLOOR = -2.2;
    const H = 15;
    const box = (sx, sy, sz, x, y, z, rz = 0) => {
      const b = new THREE.BoxGeometry(sx, sy, sz);
      b.rotateZ(rz);
      b.translate(x, y, z);
      return b;
    };
    const slope = Math.atan2(5, W - 7);
    const frameGeo = track(
      mergeGeometries([
        box(1.4, H - FLOOR, 2.2, -W, (H + FLOOR) / 2, 0),
        box(1.4, H - FLOOR, 2.2, W, (H + FLOOR) / 2, 0),
        box(Math.hypot(W - 7, 5) + 1, 1.2, 2.2, -(W + 7) / 2, H + 2.4, 0, slope),
        box(Math.hypot(W - 7, 5) + 1, 1.2, 2.2, (W + 7) / 2, H + 2.4, 0, -slope),
        box(14.4, 1.2, 2.2, 0, H + 4.9, 0),
      ]),
    );
    const stripGeo = track(
      mergeGeometries([
        box(0.18, H - FLOOR - 4, 0.3, -W + 0.8, (H + FLOOR) / 2, -1.2),
        box(0.18, H - FLOOR - 4, 0.3, W - 0.8, (H + FLOOR) / 2, -1.2),
        box(12, 0.18, 0.3, 0, H + 4.2, -1.2),
      ]),
    );
    const frameMat = track(new THREE.MeshStandardMaterial({ color: 0x1b1f25, metalness: 0.75, roughness: 0.42 }));
    const stripMat = track(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.0, 1.6) }));
    const count = 9;
    const frames = new THREE.InstancedMesh(frameGeo, frameMat, count);
    const strips = new THREE.InstancedMesh(stripGeo, stripMat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.makeTranslation(0, 0, (i - 4) * 36);
      frames.setMatrixAt(i, m);
      strips.setMatrixAt(i, m);
    }
    this.scene.add(frames, strips);
    this.frames = frames;
    this.strips = strips;

    const grid = track(gridTexture());
    grid.repeat.set(1, 400 / 42);
    const floorMat = track(new THREE.MeshLambertMaterial({ color: 0x101318, emissive: 0xffffff, emissiveMap: grid, emissiveIntensity: 0.55 }));
    const floorGeo = track(new THREE.PlaneGeometry(W * 2 + 2, 400));
    floorGeo.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.y = FLOOR;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // Lights.
    this.scene.add(new THREE.HemisphereLight(0x6a7a90, 0x0a0c10, 0.6));
    const key = new THREE.SpotLight(0xffe2c0, 420, 80, 0.6, 0.6, 1.4);
    key.position.set(10, 20, 14);
    key.target.position.set(0, 0, 0);
    key.castShadow = game.quality.shadows > 0;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key, key.target);
    const rim = new THREE.DirectionalLight(0x8fbfff, 1.6);
    rim.position.set(-12, 8, -18);
    this.scene.add(rim);
    this.lights = [key, rim];
    this.jet = null;
    this.exhaust = null;
  }

  setJet(design, paint) {
    if (this.jetDesign === design && this.jet) {
      this.jet.setPaint(paint);
      return;
    }
    this._disposeJet();
    this.jetDesign = design;
    this.jet = buildJet(design, { paint, callsign: this.game.settings.pilotName.slice(0, 8) });
    this.jet.group.position.y = 0.2;
    this.jet.group.rotation.y = Math.PI * 0.82;
    this.scene.add(this.jet.group);
    this.exhaust = new EngineExhaust({ nozzles: this.jet.anchors.nozzles, radius: 0.44, light: true });
    this.jet.group.add(this.exhaust.group);
  }

  _disposeJet() {
    if (!this.jet) return;
    this.scene.remove(this.jet.group);
    this.jet.dispose();
    this.exhaust.dispose();
    this.jet = null;
  }

  activate() {
    const r = this.game.renderer;
    r.configure({ ...this.game.quality, bloom: this.game.quality.post }, this.scene, this.camera);
    r.renderer.toneMappingExposure = 1;
  }

  render(dt) {
    this.time += dt;
    this.orbit += dt * 0.08;
    const R = 26;
    this.camera.position.set(Math.cos(this.orbit) * R, 3.5 + Math.sin(this.time * 0.2) * 0.8, Math.sin(this.orbit) * R);
    this.camera.lookAt(0, 0.4, 0);
    if (this.exhaust) this.exhaust.update(dt, this.time, 0.25 + Math.max(0, Math.sin(this.time * 0.35)) * 0.15, 0);
    if (this.jet) this.jet.group.position.y = 0.2 + Math.sin(this.time * 1.3) * 0.02;
    this.game.renderer.render(this.time);
  }

  dispose() {
    this._disposeJet();
    this.frames.dispose();
    this.strips.dispose();
    this.disposables.forEach((d) => d.dispose());
    this.lights.forEach((l) => l.dispose());
    this.envRT.dispose();
    this.scene.clear();
  }
}
