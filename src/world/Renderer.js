import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';

// Owns the WebGL renderer and the post-processing chain adapted from the
// portfolio (Render → Bloom → Tone map → Grade). The render scale can change
// at runtime (adaptive resolution) without rebuilding anything.

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.025 },
    uAberration: { value: 0.0012 },
    uBlackout: { value: 0 },
    uEmp: { value: 0 },
    uHeatA: { value: new THREE.Vector2(0.5, 0.5) },
    uHeatB: { value: new THREE.Vector2(0.5, 0.5) },
    uHeatWidth: { value: 0.02 },
    uHeat: { value: 0 },
    uSpeed: { value: 0 },
    uAspect: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uAberration, uBlackout, uEmp, uHeat, uHeatWidth, uSpeed, uAspect;
    uniform vec2 uHeatA, uHeatB;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.13) * 43758.5453); }
    float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5);
      float b = fract(sin(dot(i + vec2(1, 0), vec2(127.1, 311.7))) * 43758.5);
      float c2 = fract(sin(dot(i + vec2(0, 1), vec2(127.1, 311.7))) * 43758.5);
      float d = fract(sin(dot(i + vec2(1, 1), vec2(127.1, 311.7))) * 43758.5);
      return mix(mix(a, b, f.x), mix(c2, d, f.x), f.y); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 uv = vUv;
      // Afterburner heat haze along the exhaust (adapted from the portfolio's lens pass).
      if (uHeat > 0.01) {
        vec2 pa = uv - uHeatA, ba = uHeatB - uHeatA;
        pa.x *= uAspect; ba.x *= uAspect;
        float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
        float d = length(pa - ba * t);
        float w = uHeatWidth * (0.6 + t * 1.6);
        float m = smoothstep(w, 0.0, d) * (1.0 - t) * smoothstep(0.0, 0.08, t) * uHeat;
        vec2 n = vec2(vn(uv * 90.0 + vec2(0.0, uTime * 14.0)), vn(uv * 90.0 + vec2(uTime * 11.0, 7.0))) - 0.5;
        uv += n * m * 0.012;
      }
      uv.x += uEmp * (h(vec2(floor(vUv.y * 80.0), 1.0)) - 0.5) * 0.03;
      vec2 off = c * r2 * (uAberration + uEmp * 0.01) * 8.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      // Speed blur: radial smear towards the screen edges at high speed.
      if (uSpeed > 0.01) {
        vec3 acc = col;
        float k = uSpeed * smoothstep(0.02, 0.25, r2) * 0.06;
        for (int i = 1; i <= 5; i++) acc += texture2D(tDiffuse, uv - c * k * float(i) / 5.0).rgb;
        col = acc / 6.0;
      }
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      // Filmic grade: gentle S-curve, a touch more saturation, split-tone.
      col = mix(vec3(l), col, 1.12);
      col = clamp(col, 0.0, 1.0);
      col = col * col * (3.0 - 2.0 * col) * 0.35 + col * 0.65;
      col += (vec3(-0.008, 0.0, 0.014) * (1.0 - l) + vec3(0.016, 0.006, -0.01) * l);
      col *= 1.0 - smoothstep(0.25, 0.9, r2 * 2.2) * 0.35;
      col *= 1.0 - smoothstep(0.02, 0.5, r2 * (0.6 + uBlackout * 4.0)) * uBlackout;
      col += (h(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

// Sun shafts + lens flare in screen space. The sun's visibility is measured
// from the HDR frame itself (how bright the sky is around the sun), so the
// jet, terrain and clouds occlude both naturally.
const SunShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uOn: { value: 0 },
    uColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uAspect: { value: 1 },
    uRays: { value: 1 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    #ifndef TAPS
    #define TAPS 24
    #endif
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform float uOn, uAspect, uRays;
    uniform vec3 uColor;
    varying vec2 vUv;
    float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uOn < 0.001) { gl_FragColor = base; return; }
      // Visibility: bright sky around the sun = unoccluded.
      float vis = 0.0;
      for (int i = 0; i < 5; i++) {
        vec2 o = vec2(float(i - 2) * 0.006, float((i * 7) % 5 - 2) * 0.006);
        vis += smoothstep(1.2, 3.0, lum(texture2D(tDiffuse, clamp(uSun + o, 0.0, 1.0)).rgb));
      }
      vis = vis / 5.0 * uOn;
      vec3 add = vec3(0.0);
      #if TAPS > 0
      // God rays: march toward the sun accumulating bright samples.
      vec2 delta = (uSun - vUv) / float(TAPS) * 0.9;
      vec2 p = vUv;
      float decay = 1.0;
      vec3 rays = vec3(0.0);
      for (int i = 0; i < TAPS; i++) {
        p += delta;
        vec3 s = texture2D(tDiffuse, clamp(p, 0.0, 1.0)).rgb;
        rays += max(s - 1.0, 0.0) * decay;
        decay *= 0.93;
      }
      add += rays / float(TAPS) * uColor * 0.4 * uRays * uOn;
      #endif
      // Lens flare: halo, starburst and ghosts mirrored through the centre.
      vec2 d = vUv - uSun;
      d.x *= uAspect;
      float r = length(d);
      float halo = exp(-r * 12.0) * 0.18 + smoothstep(0.32, 0.3, r) * smoothstep(0.27, 0.3, r) * 0.04;
      float ang = atan(d.y, d.x);
      float star = pow(abs(cos(ang * 3.0)), 40.0) * exp(-r * 6.0) * 0.4;
      vec3 flare = uColor * (halo + star);
      vec2 axis = vec2(0.5) - uSun;
      for (int i = 0; i < 5; i++) {
        float k = float(i) * 0.38 + 0.35;
        vec2 gp = uSun + axis * k * 2.0;
        vec2 gd = vUv - gp;
        gd.x *= uAspect;
        float size = 0.02 + float(i) * 0.012;
        float g = smoothstep(size, size * 0.6, length(gd)) * (0.05 + 0.03 * float(i));
        vec3 tint = i == 1 ? vec3(0.4, 0.8, 1.0) : i == 3 ? vec3(1.0, 0.5, 0.3) : vec3(0.7, 1.0, 0.6);
        flare += tint * g;
      }
      add += flare * vis;
      gl_FragColor = vec4(base.rgb + add, base.a);
    }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
    });
    const r = this.renderer;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.setClearColor(0x000000, 1);
    r.info.autoReset = false;
    this.scale = 1;
    this.composer = null;
    this.quality = null;
    this.width = 1;
    this.height = 1;
  }

  configure(quality, scene, camera) {
    this.disposePost();
    this.quality = quality;
    this.scene = scene;
    this.camera = camera;
    const r = this.renderer;
    r.shadowMap.enabled = quality.shadows > 0;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.scale = quality.renderScale;
    if (quality.post) {
      const rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: quality.id === 'ultra' ? 4 : quality.id === 'high' ? 2 : 0 });
      this.composer = new EffectComposer(r, rt);
      this.composer.addPass(new RenderPass(scene, camera));
      if (quality.flare || quality.godRays) {
        this.sun = new ShaderPass({ ...SunShader, defines: { TAPS: quality.godRays || 0 } });
        this.composer.addPass(this.sun);
      }
      if (quality.bloom) {
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.35, 0.92);
        this.composer.addPass(this.bloom);
      }
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);
      if (quality.fxaa) {
        this.fxaa = new ShaderPass(FXAAShader);
        this.composer.addPass(this.fxaa);
      }
    }
    this.resize();
  }

  get pixelRatio() {
    return Math.min(window.devicePixelRatio || 1, this.quality?.maxPixelRatio ?? 1) * this.scale;
  }

  setScale(s) {
    this.scale = s;
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    const pr = this.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.composer) {
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
      this.grade.uniforms.uAspect.value = w / h;
      if (this.sun) this.sun.uniforms.uAspect.value = w / h;
      if (this.fxaa) this.fxaa.uniforms.resolution.value.set(1 / (w * pr), 1 / (h * pr));
      if (this.bloom) {
        const bs = this.quality.bloomScale;
        this.bloom.setSize(w * pr * bs * 2, h * pr * bs * 2);
      }
    }
  }

  setEffects(blackout, emp) {
    if (!this.grade) return;
    this.grade.uniforms.uBlackout.value = blackout;
    this.grade.uniforms.uEmp.value = emp;
  }

  /** Screen-space sun (uv), on-screen weight, colour. */
  setSun(x, y, on, color) {
    if (!this.sun) return;
    const u = this.sun.uniforms;
    u.uSun.value.set(x, y);
    u.uOn.value = on;
    if (color) u.uColor.value.copy(color);
  }

  /** Heat haze segment in screen uv, and speed blur amount. */
  setHeat(ax, ay, bx, by, width, amount, speed) {
    if (!this.grade || !this.quality.heat) return;
    const u = this.grade.uniforms;
    u.uHeatA.value.set(ax, ay);
    u.uHeatB.value.set(bx, by);
    u.uHeatWidth.value = width;
    u.uHeat.value = amount;
    u.uSpeed.value = speed;
  }

  render(time) {
    this.renderer.info.reset();
    if (this.composer) {
      this.grade.uniforms.uTime.value = time % 100;
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  disposePost() {
    if (!this.composer) return;
    this.composer.passes.forEach((p) => p.dispose?.());
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer = null;
    this.bloom = null;
    this.grade = null;
    this.sun = null;
    this.fxaa = null;
  }
}
