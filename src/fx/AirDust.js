import * as THREE from 'three';

// Adapted from the portfolio's Dust: tiny moisture/ice particles fixed in
// world space and wrapped in a box around the camera. As the jet moves they
// stream past, which sells speed. Each point is stretched into a short streak
// along the camera's velocity in the shader.

const BOX = 220;

export class AirDust {
  constructor(count, sky) {
    this.count = count;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos.set([Math.random() * BOX, Math.random() * BOX, Math.random() * BOX], i * 3);
      seed[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uBox: { value: BOX },
        uPixelRatio: { value: 1 },
        uSpeed: { value: 0 },
        uSunDir: sky.uniforms.uSunDir,
        uSunColor: sky.uniforms.uSunColor,
        uSunStrength: sky.uniforms.uSunStrength,
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uBox, uPixelRatio, uSpeed;
        uniform vec3 uSunDir;
        varying float vAlpha;
        varying float vSun;
        void main() {
          vec3 w = cameraPosition + mod(position - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
          vec4 mv = viewMatrix * vec4(w, 1.0);
          float d = length(mv.xyz);
          vAlpha = smoothstep(3.0, 12.0, d) * (1.0 - smoothstep(uBox * 0.3, uBox * 0.5, d)) * (0.3 + aSeed * 0.7) * smoothstep(40.0, 160.0, uSpeed);
          vSun = pow(max(dot(normalize(w - cameraPosition), uSunDir), 0.0), 6.0);
          gl_PointSize = (0.8 + aSeed * 1.6) * uPixelRatio * (90.0 / d);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSunColor;
        uniform float uSunStrength;
        varying float vAlpha;
        varying float vSun;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vAlpha;
          gl_FragColor = vec4((vec3(0.55, 0.6, 0.7) * (0.2 + uSunStrength) + uSunColor * vSun * 2.0) * a * 0.6, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
  }

  update(speed, pixelRatio) {
    this.material.uniforms.uSpeed.value = speed;
    this.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  dispose() {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}
