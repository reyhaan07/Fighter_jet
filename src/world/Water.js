import * as THREE from 'three';
import { NOISE } from './glsl.js';

// Ocean surface at y = 0. Normals come from a sum of directional
// (Gerstner-style) waves plus noise ripples; colour blends from turquoise
// shallows to deep blue using the terrain's depth map, with animated surf
// along every shoreline, Fresnel sky reflection, sun glitter and fog.
// The plane follows the camera so it always reaches the horizon.

export class Water {
  constructor(sky, fogDensity, terrain) {
    this.geometry = new THREE.PlaneGeometry(1, 1, 1, 1);
    this.geometry.rotateX(-Math.PI / 2);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSunDir: sky.uniforms.uSunDir,
        uSunColor: sky.uniforms.uSunColor,
        uSunStrength: sky.uniforms.uSunStrength,
        uHorizon: sky.uniforms.uHorizon,
        uZenith: sky.uniforms.uZenith,
        uDeep: { value: new THREE.Color(0.004, 0.03, 0.06) },
        uShallow: { value: new THREE.Color(0.03, 0.26, 0.27) },
        uFogDensity: { value: fogDensity },
        uDepthMap: { value: terrain.depthTexture },
        uMapHalf: { value: terrain.half },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uSunStrength, uFogDensity, uMapHalf;
        uniform vec3 uSunDir, uSunColor, uHorizon, uZenith, uDeep, uShallow;
        uniform sampler2D uDepthMap;
        varying vec3 vWorld;
        ${NOISE}
        // Slope of one directional wave (returns d/dx, d/dz).
        vec2 wave(vec2 p, vec2 dir, float k, float amp, float speed, float t) {
          float ph = dot(dir, p) * k + t * speed;
          return dir * (amp * k * cos(ph));
        }
        void main() {
          vec2 p = vWorld.xz;
          float t = uTime;
          vec3 toCam = cameraPosition - vWorld;
          float dist = length(toCam);
          vec3 v = toCam / dist;
          float detail = 1.0 - smoothstep(800.0, 6000.0, dist);

          vec2 g = vec2(0.0);
          g += wave(p, normalize(vec2(1.0, 0.3)), 0.021, 1.1, 1.3, t);
          g += wave(p, normalize(vec2(0.6, 1.0)), 0.034, 0.6, 1.7, t);
          g += wave(p, normalize(vec2(-0.7, 0.45)), 0.057, 0.35, 2.3, t);
          g += wave(p, normalize(vec2(0.2, -1.0)), 0.093, 0.18, 3.1, t) * detail;
          vec2 q = p * 0.11 + vec2(t * 0.25, t * 0.17);
          float r0 = vnoise(q);
          g += vec2(vnoise(q + vec2(0.4, 0.0)) - r0, vnoise(q + vec2(0.0, 0.4)) - r0) * 0.9 * detail;
          vec3 n = normalize(vec3(-g.x, 1.0, -g.y));

          // Depth from the terrain map (outside the map: open ocean).
          vec2 duv = (p + uMapHalf) / (2.0 * uMapHalf);
          float inside = step(0.0, duv.x) * step(duv.x, 1.0) * step(0.0, duv.y) * step(duv.y, 1.0);
          float depth = mix(40.0, texture2D(uDepthMap, clamp(duv, 0.0, 1.0)).r * 40.0, inside);

          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, v), 0.0), 5.0);
          vec3 r = reflect(-v, n);
          vec3 skyCol = mix(uHorizon, uZenith, smoothstep(0.0, 0.5, r.y));
          float sunAmt = uSunStrength;
          vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 28.0, depth)) * (0.35 + 0.65 * clamp(sunAmt * 1.2, 0.0, 1.0));
          // Light scattering through wave crests.
          water += uShallow * max(0.0, g.x + g.y) * 0.25 * sunAmt;
          vec3 col = mix(water, skyCol, fres);
          float sd = max(dot(r, uSunDir), 0.0);
          col += uSunColor * sunAmt * (pow(sd, 900.0) * 60.0 + pow(sd, 60.0) * 0.6);

          // Surf: a bright line on the shore plus bands rolling in.
          float fn = vnoise(p * 0.07 + t * 0.25) * 0.6 + vnoise(p * 0.21 - t * 0.4) * 0.4;
          float line = 1.0 - smoothstep(0.0, 2.2 + fn * 2.0, depth);
          float bands = smoothstep(0.6, 1.0, sin(depth * 1.3 - t * 1.6 + fn * 5.0) * 0.5 + 0.5) * (1.0 - smoothstep(0.5, 9.0, depth));
          // Whitecaps on the open sea, on the steepest crests.
          float caps = smoothstep(0.13, 0.17, length(g)) * smoothstep(0.72, 0.9, fn) * detail * 0.35;
          float foam = clamp(line * 0.95 + bands * 0.7 + caps, 0.0, 1.0) * (0.55 + 0.45 * fn) * inside + caps * (1.0 - inside);
          vec3 foamCol = vec3(0.92, 0.95, 0.97) * clamp(sunAmt * 1.05, 0.06, 1.0) + uZenith * 0.3;
          col = mix(col, foamCol, foam);

          float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
          col = mix(col, uHorizon, fog);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.scale.set(80000, 1, 80000);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
  }

  update(camera, time) {
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
    this.material.uniforms.uTime.value = time;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
