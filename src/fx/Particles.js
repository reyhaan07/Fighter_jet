import * as THREE from 'three';

// GPU particle system: one InstancedBufferGeometry ring buffer, one draw
// call. The CPU only writes a particle's initial state when it is emitted;
// the vertex shader evaluates position/size/colour from (time - birth), so
// there is no per-particle CPU update and nothing is allocated per frame.
//
// Particle kinds: 0 glow (soft round), 1 smoke (textured puff), 2 spark
// (stretched along its velocity).

const STRIDE = 18; // pos3 vel3 time4 color4 params4

function smokeTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d');
  const img = g.createImageData(s, s);
  // A few octaves of value noise, masked by a radial falloff.
  const rnd = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const noise = (x, y) => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = rnd(ix, iy);
    const b = rnd(ix + 1, iy);
    const cc = rnd(ix, iy + 1);
    const d = rnd(ix + 1, iy + 1);
    return a + (b - a) * ux + (cc - a) * uy + (a - b - cc + d) * ux * uy;
  };
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const nx = x / s - 0.5;
      const ny = y / s - 0.5;
      const r = Math.sqrt(nx * nx + ny * ny) * 2;
      let n = 0;
      let amp = 0.5;
      let f = 4;
      for (let o = 0; o < 4; o++) {
        n += noise(x / (s / f), y / (s / f)) * amp;
        amp *= 0.5;
        f *= 2;
      }
      const a = Math.max(0, Math.min(1, (1 - r) * 1.6 - (1 - n) * 0.8));
      const i = (y * s + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 200 + n * 55;
      img.data[i + 3] = a * 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const vertexShader = /* glsl */ `
  attribute vec3 aPos;
  attribute vec3 aVel;
  attribute vec4 aTime;   // birth, life, size0, size1
  attribute vec4 aColor;  // rgb, alpha
  attribute vec4 aParams; // drag, gravity, seed, kind
  uniform float uTime;
  uniform float uFogDensity;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vSeed;
  varying float vT;
  void main() {
    float age = uTime - aTime.x;
    float t = age / aTime.y;
    if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    float drag = aParams.x;
    float k = drag > 0.0 ? (1.0 - exp(-drag * age)) / drag : age;
    vec3 p = aPos + aVel * k;
    p.y -= 0.5 * aParams.y * age * age;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    float size = mix(aTime.z, aTime.w, 1.0 - (1.0 - t) * (1.0 - t));
    vec2 corner = position.xy;
    if (aParams.w > 1.5 && aParams.w < 2.5) {
      // Spark: stretch along the projected velocity.
      vec3 v = aVel * exp(-drag * age) - vec3(0.0, aParams.y * age, 0.0);
      vec3 vv = (viewMatrix * vec4(v, 0.0)).xyz;
      vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
      vec2 nrm = vec2(-dir.y, dir.x);
      float len = size + length(vv.xy) * 0.03;
      mv.xy += dir * corner.y * len + nrm * corner.x * size * 0.25;
    } else {
      float a = aParams.z * 6.2831 + age * (aParams.z - 0.5) * 1.5;
      float c = cos(a), s = sin(a);
      mv.xy += mat2(c, -s, s, c) * corner * size;
    }
    gl_Position = projectionMatrix * mv;
    float fade = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.55, 1.0, t));
    float dist = length(mv.xyz);
    // Puffs right in front of the camera fade out: they would cover the whole
    // screen (huge overdraw on phones) and look like a smudge anyway.
    fade *= smoothstep(size * 0.8, size * 2.6, dist);
    float fog = exp(-uFogDensity * uFogDensity * dist * dist);
    vColor = vec4(aColor.rgb, aColor.a * fade);
    vColor *= fog;
    if (vColor.a < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    vUv = position.xy + 0.5;
    vKind = aParams.w;
    vSeed = aParams.z;
    vT = t;
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uSmoke;
  uniform vec3 uFogColor;
  uniform float uAdditive;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vKind;
  varying float vSeed;
  varying float vT;
  void main() {
    float a;
    if (vKind > 0.5 && vKind < 1.5) {
      a = texture2D(uSmoke, vUv * 0.92 + vSeed * 0.05).a;
    } else if (vKind > 2.5) {
      // Shockwave ring.
      float d = length(vUv - 0.5) * 2.0;
      a = smoothstep(0.7, 0.92, d) * smoothstep(1.0, 0.93, d);
    } else {
      float d = length(vUv - 0.5) * 2.0;
      a = pow(clamp(1.0 - d, 0.0, 1.0), 1.6);
    }
    a *= vColor.a;
    if (a < 0.004) discard;
    if (uAdditive > 0.5) {
      gl_FragColor = vec4(vColor.rgb * a, 1.0);
    } else {
      // vColor was pre-multiplied by fog transmittance; blend toward fog colour.
      gl_FragColor = vec4(vColor.rgb, a);
    }
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

export class ParticleSystem {
  constructor(capacity, { additive, fogDensity, fogColor, texture }) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    // Park every slot in the past so nothing renders until emitted.
    for (let i = 0; i < capacity; i++) {
      this.data[i * STRIDE + 6] = -1e6;
      this.data[i * STRIDE + 7] = 1;
    }
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    geo.setAttribute('aVel', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    geo.setAttribute('aTime', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 10));
    geo.setAttribute('aParams', new THREE.InterleavedBufferAttribute(this.buffer, 4, 14));
    geo.instanceCount = capacity;
    this.quad = quad;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSmoke: { value: texture },
        uFogDensity: { value: fogDensity },
        uFogColor: { value: fogColor },
        uAdditive: { value: additive ? 1 : 0 },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 20 : 15;
    this.head = 0;
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.time = 0;
    this.emitted = 0;
  }

  emit(x, y, z, vx, vy, vz, life, size0, size1, r, g, b, a, drag, gravity, kind, delay = 0) {
    const i = this.head;
    this.head = (i + 1) % this.capacity;
    const o = i * STRIDE;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = vx;
    d[o + 4] = vy;
    d[o + 5] = vz;
    d[o + 6] = this.time + delay;
    d[o + 7] = life;
    d[o + 8] = size0;
    d[o + 9] = size1;
    d[o + 10] = r;
    d[o + 11] = g;
    d[o + 12] = b;
    d[o + 13] = a;
    d[o + 14] = drag;
    d[o + 15] = gravity;
    d[o + 16] = Math.random();
    d[o + 17] = kind;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
    this.emitted++;
  }

  /** Uploads the slots written since the last frame. */
  update(time) {
    this.material.uniforms.uTime.value = time;
    if (this.dirtyMax >= 0) {
      const b = this.buffer;
      b.clearUpdateRanges();
      b.addUpdateRange(this.dirtyMin * STRIDE, (this.dirtyMax - this.dirtyMin + 1) * STRIDE);
      b.needsUpdate = true;
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
  }

  /** Kills all live particles (level restart). */
  clear() {
    for (let i = 0; i < this.capacity; i++) this.data[i * STRIDE + 6] = -1e6;
    this.dirtyMin = 0;
    this.dirtyMax = this.capacity - 1;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}

export { smokeTexture };
