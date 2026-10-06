import * as THREE from 'three';

// Per-frame instanced batches that are rebuilt every rendered frame from
// pooled simulation data: glow sprites (engine glows, flares, plasma bolts)
// and beams (bullet tracers, laser and railgun beams). One draw call each.

export class GlowBatch {
  constructor(capacity, fogDensity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * 8); // pos3 size, rgb, pad
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, 8);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPosSize', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    geo.instanceCount = 0;
    this.quad = quad;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uFogDensity: { value: fogDensity } },
      vertexShader: /* glsl */ `
        attribute vec4 aPosSize;
        attribute vec4 aColor;
        uniform float uFogDensity;
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          vec4 mv = viewMatrix * vec4(aPosSize.xyz, 1.0);
          float d = length(mv.xyz);
          float size = max(aPosSize.w, d * 0.004 * aColor.w); // keep a minimum on-screen size
          mv.xy += position.xy * size;
          gl_Position = projectionMatrix * mv;
          vUv = position.xy + 0.5;
          vColor = aColor.rgb * exp(-uFogDensity * uFogDensity * d * d * 0.5);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec3 vColor;
        void main() {
          float d = length(vUv - 0.5) * 2.0;
          float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.2);
          gl_FragColor = vec4(vColor * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 22;
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  /** minScreen: how much the sprite keeps its size at distance (0 = none). */
  add(x, y, z, size, r, g, b, minScreen = 1) {
    if (this.count >= this.capacity) return;
    const o = this.count++ * 8;
    const d = this.data;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = z;
    d[o + 3] = size;
    d[o + 4] = r;
    d[o + 5] = g;
    d[o + 6] = b;
    d[o + 7] = minScreen;
  }

  end() {
    this.mesh.geometry.instanceCount = this.count;
    if (this.count) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, this.count * 8);
      this.buffer.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}

export class BeamBatch {
  constructor(capacity, fogDensity) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * 12); // start3 width, end3 minpx, rgb a
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, 12);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aStart', new THREE.InterleavedBufferAttribute(this.buffer, 4, 0));
    geo.setAttribute('aEnd', new THREE.InterleavedBufferAttribute(this.buffer, 4, 4));
    geo.setAttribute('aColor', new THREE.InterleavedBufferAttribute(this.buffer, 4, 8));
    geo.instanceCount = 0;
    this.quad = quad;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uFogDensity: { value: fogDensity } },
      vertexShader: /* glsl */ `
        attribute vec4 aStart; // xyz, width
        attribute vec4 aEnd;   // xyz, min width per metre of distance
        attribute vec4 aColor;
        uniform float uFogDensity;
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          vec4 a = viewMatrix * vec4(aStart.xyz, 1.0);
          vec4 b = viewMatrix * vec4(aEnd.xyz, 1.0);
          float along = position.y + 0.5;
          vec4 p = mix(a, b, along);
          vec2 dir = b.xy / max(-b.z, 0.1) - a.xy / max(-a.z, 0.1);
          dir = length(dir) > 1e-5 ? normalize(dir) : vec2(0.0, 1.0);
          vec2 n = vec2(-dir.y, dir.x);
          float d = length(p.xyz);
          float w = max(aStart.w, d * aEnd.w);
          p.xy += n * position.x * w;
          gl_Position = projectionMatrix * p;
          vUv = vec2(position.x + 0.5, along);
          vColor = vec4(aColor.rgb * exp(-uFogDensity * uFogDensity * d * d * 0.5), aColor.a);
        }`,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying vec4 vColor;
        void main() {
          float across = 1.0 - abs(vUv.x - 0.5) * 2.0;
          float a = pow(across, 1.5) * mix(0.15, 1.0, vUv.y) * vColor.a; // bright head, fading tail
          gl_FragColor = vec4(vColor.rgb * a, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 21;
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  add(sx, sy, sz, ex, ey, ez, width, minW, r, g, b, a = 1) {
    if (this.count >= this.capacity) return;
    const o = this.count++ * 12;
    const d = this.data;
    d[o] = sx;
    d[o + 1] = sy;
    d[o + 2] = sz;
    d[o + 3] = width;
    d[o + 4] = ex;
    d[o + 5] = ey;
    d[o + 6] = ez;
    d[o + 7] = minW;
    d[o + 8] = r;
    d[o + 9] = g;
    d[o + 10] = b;
    d[o + 11] = a;
  }

  end() {
    this.mesh.geometry.instanceCount = this.count;
    if (this.count) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(0, this.count * 12);
      this.buffer.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.quad.dispose();
    this.material.dispose();
  }
}
