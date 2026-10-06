import * as THREE from 'three';

// Tumbling debris chunks, fully GPU-evaluated like the particles: emit writes
// the initial state, the vertex shader integrates gravity and spin. One draw
// call for every piece of debris in the level.

const STRIDE = 12; // pos3 vel3 birth life size seed color(r,g)

export class Debris {
  constructor(capacity, fogDensity, fogColor, sunDir) {
    this.capacity = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    for (let i = 0; i < capacity; i++) this.data[i * STRIDE + 6] = -1e6;
    const base = new THREE.TetrahedronGeometry(1, 0);
    base.computeVertexNormals();
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute('position', base.getAttribute('position'));
    geo.setAttribute('normal', base.getAttribute('normal'));
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aPos', new THREE.InterleavedBufferAttribute(this.buffer, 3, 0));
    geo.setAttribute('aVel', new THREE.InterleavedBufferAttribute(this.buffer, 3, 3));
    geo.setAttribute('aLife', new THREE.InterleavedBufferAttribute(this.buffer, 4, 6));
    geo.setAttribute('aCol', new THREE.InterleavedBufferAttribute(this.buffer, 2, 10));
    geo.instanceCount = capacity;
    this.base = base;
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uFogDensity: { value: fogDensity },
        uFogColor: { value: fogColor },
        uSunDir: { value: sunDir },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aPos, aVel;
        attribute vec4 aLife; // birth, life, size, seed
        attribute vec2 aCol;  // brightness, ember
        uniform float uTime, uFogDensity;
        varying vec3 vN;
        varying float vFog, vBright, vEmber;
        mat3 rot(vec3 axis, float a) {
          axis = normalize(axis);
          float s = sin(a), c = cos(a), oc = 1.0 - c;
          return mat3(oc*axis.x*axis.x + c, oc*axis.x*axis.y + axis.z*s, oc*axis.z*axis.x - axis.y*s,
                      oc*axis.x*axis.y - axis.z*s, oc*axis.y*axis.y + c, oc*axis.y*axis.z + axis.x*s,
                      oc*axis.z*axis.x + axis.y*s, oc*axis.y*axis.z - axis.x*s, oc*axis.z*axis.z + c);
        }
        void main() {
          float age = uTime - aLife.x;
          if (age < 0.0 || age > aLife.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          float k = (1.0 - exp(-0.6 * age)) / 0.6;
          vec3 p = aPos + aVel * k;
          p.y -= 4.9 * age * age;
          vec3 axis = vec3(fract(aLife.w * 13.1) - 0.5, fract(aLife.w * 7.3) - 0.5, 0.3);
          mat3 R = rot(axis, age * (4.0 + aLife.w * 8.0) + aLife.w * 20.0);
          float shrink = 1.0 - smoothstep(0.8, 1.0, age / aLife.y);
          vec3 local = R * (position * vec3(1.0, 0.45, 0.8) * aLife.z * shrink);
          vN = R * normal;
          vec4 mv = viewMatrix * vec4(p + local, 1.0);
          gl_Position = projectionMatrix * mv;
          float d = length(mv.xyz);
          vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
          vBright = aCol.x;
          vEmber = aCol.y * (1.0 - smoothstep(0.0, 2.5, age));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uFogColor, uSunDir;
        varying vec3 vN;
        varying float vFog, vBright, vEmber;
        void main() {
          float l = 0.35 + 0.65 * max(dot(normalize(vN), uSunDir), 0.0);
          vec3 col = vec3(0.16, 0.16, 0.17) * vBright * l + vec3(3.0, 1.2, 0.3) * vEmber;
          col = mix(col, uFogColor, vFog);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.head = 0;
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.time = 0;
  }

  emit(x, y, z, vx, vy, vz, life, size, bright = 1, ember = 0) {
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
    d[o + 6] = this.time;
    d[o + 7] = life;
    d[o + 8] = size;
    d[o + 9] = Math.random();
    d[o + 10] = bright;
    d[o + 11] = ember;
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  update(time) {
    this.material.uniforms.uTime.value = time;
    if (this.dirtyMax >= 0) {
      this.buffer.clearUpdateRanges();
      this.buffer.addUpdateRange(this.dirtyMin * STRIDE, (this.dirtyMax - this.dirtyMin + 1) * STRIDE);
      this.buffer.needsUpdate = true;
      this.dirtyMin = Infinity;
      this.dirtyMax = -1;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.base.dispose();
    this.material.dispose();
  }
}
