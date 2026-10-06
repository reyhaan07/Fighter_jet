import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

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
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uGrain, uAberration, uBlackout, uEmp;
    varying vec2 vUv;
    float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + uTime * 7.13) * 43758.5453); }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 uv = vUv;
      uv.x += uEmp * (h(vec2(floor(vUv.y * 80.0), 1.0)) - 0.5) * 0.03;
      vec2 off = c * r2 * (uAberration + uEmp * 0.01) * 8.0;
      vec3 col;
      col.r = texture2D(tDiffuse, uv + off).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - off).b;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col += (vec3(-0.008, 0.0, 0.014) * (1.0 - l) + vec3(0.016, 0.006, -0.01) * l);
      col *= 1.0 - smoothstep(0.25, 0.9, r2 * 2.2) * 0.35;
      col *= 1.0 - smoothstep(0.02, 0.5, r2 * (0.6 + uBlackout * 4.0)) * uBlackout;
      col += (h(vUv * 1000.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
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
      if (quality.bloom) {
        this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.55, 0.35, 0.92);
        this.composer.addPass(this.bloom);
      }
      this.composer.addPass(new OutputPass());
      this.grade = new ShaderPass(GradeShader);
      this.composer.addPass(this.grade);
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
  }
}
