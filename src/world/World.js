import * as THREE from 'three';
import { Sky } from './Sky.js';
import { Terrain } from './Terrain.js';
import { Water } from './Water.js';
import { Clouds } from './Clouds.js';

// Assembles the environment for one level: sky, lights, fog, reflections,
// terrain, sea and clouds. Everything created here is disposed in dispose().

export class World {
  constructor(renderer, scene, quality, env) {
    this.renderer = renderer;
    this.scene = scene;
    this.quality = quality;
    const viewDistance = quality.viewDistance;
    this.fogDensity = 1.5 / viewDistance;

    this.sky = new Sky(env.time || 'day');
    const p = this.sky.preset;
    scene.add(this.sky.mesh);
    scene.fog = new THREE.FogExp2(this.sky.uniforms.uHorizon.value.clone(), this.fogDensity);
    renderer.toneMappingExposure = p.exposure;

    // Lights.
    this.hemi = new THREE.HemisphereLight(p.hemiSky, p.hemiGround, p.hemi);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(new THREE.Color().setRGB(...p.sunColor), p.sunLight);
    this.sunDir = this.sky.uniforms.uSunDir.value.clone();
    if (quality.shadows) {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(quality.shadows, quality.shadows);
      const sc = this.sun.shadow.camera;
      sc.left = sc.bottom = -60;
      sc.right = sc.top = 60;
      sc.near = 1;
      sc.far = 600;
      this.sun.shadow.bias = -0.0005;
      this.sun.shadow.normalBias = 0.05;
    }
    scene.add(this.sun, this.sun.target);

    // Reflections: prefilter the sky once per level.
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky(env.time || 'day');
    envSky.material.uniforms.uDisc.value *= 0.3;
    envScene.add(envSky.mesh);
    this.envRT = pmrem.fromScene(envScene, 0, 1, 2000);
    scene.environment = this.envRT.texture;
    envSky.dispose();
    pmrem.dispose();

    this.terrain = new Terrain({
      size: env.mapSize || 32000,
      res: quality.terrainRes,
      seed: env.seed || 1,
      type: env.terrain || 'islands',
      flatZones: env.flatZones || [],
    });
    scene.add(this.terrain.mesh);
    this.water = new Water(this.sky, this.fogDensity);
    scene.add(this.water.mesh);
    this.clouds = new Clouds({
      count: Math.round(quality.clouds * (env.cloudiness ?? 1)),
      sky: this.sky,
      fogDensity: this.fogDensity,
      base: env.cloudBase ?? 1900,
      night: env.time === 'night',
    });
    scene.add(this.clouds.mesh);
  }

  heightAt(x, z) {
    return this.terrain.heightAt(x, z);
  }

  surfaceAt(x, z) {
    return this.terrain.surfaceAt(x, z);
  }

  update(camera, time, focus) {
    this.sky.update(camera, time);
    this.water.update(camera, time);
    this.clouds.update(time);
    // Shadow frustum follows the player's aircraft.
    this.sun.target.position.copy(focus);
    this.sun.position.copy(focus).addScaledVector(this.sunDir, 300);
  }

  dispose() {
    this.scene.remove(this.sky.mesh, this.hemi, this.sun, this.sun.target, this.terrain.mesh, this.water.mesh, this.clouds.mesh);
    this.sun.dispose();
    this.sun.shadow?.map?.dispose();
    this.sky.dispose();
    this.terrain.dispose();
    this.water.dispose();
    this.clouds.dispose();
    this.envRT.dispose();
    this.scene.environment = null;
    this.scene.fog = null;
  }
}
