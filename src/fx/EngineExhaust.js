import * as THREE from 'three';
import { NOISE } from '../world/glsl.js';

// Adapted from the portfolio. Volumetric-looking afterburner plume: nested additive cones with a view-
// dependent falloff (so edges dissolve), faint shock diamonds, a white-blue
// core and an amber sheath. Length and brightness follow the throttle.

const plumeVertex = /* glsl */ `
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;
void main() {
  vLocal = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormalV = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const plumeFragment = /* glsl */ `
uniform float uTime;
uniform float uThrottle;
uniform float uLength;
uniform float uLayer;       // 0 = core, 1 = sheath
uniform vec3 uCoreColor;
uniform vec3 uEdgeColor;
varying vec3 vLocal;
varying vec3 vNormalV;
varying vec3 vViewDir;
${NOISE}
void main() {
  float t = clamp(vLocal.z / uLength, 0.0, 1.0); // 0 at nozzle → 1 at tail
  float facing = abs(dot(normalize(vNormalV), normalize(vViewDir)));
  float soft = pow(facing, mix(1.6, 2.6, uLayer));

  float n = fbm(vec2(vLocal.z * 1.7 - uTime * 9.0, atan(vLocal.y, vLocal.x) * 1.3));
  float flicker = 0.75 + 0.5 * n;

  float diamonds = 0.5 + 0.5 * cos(t * 6.2831 * 4.0 - 0.6);
  diamonds = pow(diamonds, 6.0) * (1.0 - t) * (1.0 - uLayer) * 0.9;

  float along = pow(1.0 - t, mix(1.4, 2.2, uLayer)) * smoothstep(0.0, 0.05, t + 0.02);
  vec3 col = mix(uCoreColor, uEdgeColor, clamp(t * 1.6 + uLayer * 0.5, 0.0, 1.0));
  float a = soft * along * flicker * (1.0 + diamonds * 2.0);
  a *= uThrottle * mix(1.0, 0.45, uLayer);
  gl_FragColor = vec4(col * a, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
       
}
`;

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.15, 'rgba(255,240,220,0.85)');
  grd.addColorStop(0.4, 'rgba(255,170,90,0.25)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class EngineExhaust {
  constructor({ nozzles, radius, light = true }) {
    this.group = new THREE.Group();
    this.length = 7;
    this.throttle = 0.8;
    this.lights = [];
    this.materials = [];
    this.disposables = [];

    const coreGeo = new THREE.CylinderGeometry(radius * 0.14, radius * 0.72, this.length, 32, 24, true);
    coreGeo.rotateX(Math.PI / 2);
    coreGeo.translate(0, 0, this.length / 2);
    const sheathGeo = new THREE.CylinderGeometry(radius * 0.55, radius * 0.98, this.length * 1.25, 32, 24, true);
    sheathGeo.rotateX(Math.PI / 2);
    sheathGeo.translate(0, 0, (this.length * 1.25) / 2);
    this.disposables.push(coreGeo, sheathGeo);

    const makeMat = (layer, len) => {
      const m = new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uThrottle: { value: 1 },
          uLength: { value: len },
          uLayer: { value: layer },
          uCoreColor: { value: layer ? new THREE.Color(1.4, 0.8, 0.42) : new THREE.Color(2.0, 2.2, 2.8) },
          uEdgeColor: { value: layer ? new THREE.Color(0.6, 0.2, 0.05) : new THREE.Color(1.8, 0.8, 0.3) },
        },
        vertexShader: plumeVertex,
        fragmentShader: plumeFragment,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return m;
    };

    this.glowTex = glowTexture();
    this.disposables.push(this.glowTex);

    this.plumes = [];
    for (const p of nozzles) {
      const g = new THREE.Group();
      g.position.copy(p);
      const core = new THREE.Mesh(coreGeo, makeMat(0, this.length));
      const sheath = new THREE.Mesh(sheathGeo, makeMat(1, this.length * 1.25));
      core.renderOrder = 10;
      sheath.renderOrder = 9;

      const glowMat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: new THREE.Color(1.5, 1.05, 0.75),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      this.materials.push(glowMat);
      const glow = new THREE.Sprite(glowMat);
      glow.scale.setScalar(radius * 2.6);
      glow.position.z = 0.15;
      glow.renderOrder = 11;

      g.add(sheath, core, glow);
      this.group.add(g);
      this.plumes.push({ group: g, core, sheath, glow });
    }

    // One warm light between the nozzles lights the tail, stabilators and the hangar floor.
    const center = nozzles.reduce((a, b) => a.clone().add(b)).multiplyScalar(1 / nozzles.length);
    if (light) {
      const l = new THREE.PointLight(0xff9a4a, 12, 20, 1.7);
      l.position.copy(center).add(new THREE.Vector3(0, 0, 1.6));
      this.group.add(l);
      this.lights.push(l);
    }

    this.heatAnchor = center.clone();
    this.enabled = true;
  }

  /** throttle 0..1 military power, ab 0..1 afterburner. */
  update(dt, time, throttle, ab = 0) {
    throttle = Math.min(1, throttle * 0.55 + ab * 0.75);
    this.throttle = throttle;
    const pulse = 1 + Math.sin(time * 31) * 0.03 + Math.sin(time * 17.3) * 0.03;
    const len = 0.25 + 1.1 * throttle;
    for (const p of this.plumes) {
      p.core.scale.set(1, 1, len * pulse);
      p.sheath.scale.set(1 + throttle * 0.15, 1 + throttle * 0.15, len);
      p.glow.material.opacity = 0.6 + 0.4 * throttle;
      p.glow.scale.setScalar((0.9 + throttle * 0.5) * pulse);
    }
    for (const m of this.materials) {
      if (m.uniforms) {
        m.uniforms.uTime.value = time;
        m.uniforms.uThrottle.value = 0.35 + throttle * 0.9;
      }
    }
    for (const l of this.lights) l.intensity = (7 + throttle * 13) * pulse;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.materials.forEach((m) => m.dispose());
    this.lights.forEach((l) => l.dispose());
  }
}
