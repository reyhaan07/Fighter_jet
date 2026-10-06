// Graphics quality presets + hardware auto-detection.
//
// renderScale     multiplier on the (capped) device pixel ratio
// shadows         shadow map size (0 = off)
// bloom           post-processing bloom on/off
// bloomScale      bloom buffer resolution relative to the screen
// particles       GPU particle capacity per system
// viewDistance    camera far plane / fog distance in metres
// terrainRes      terrain grid resolution (vertices per side)
// clouds          number of cloud billboards
// lights          pooled dynamic point lights for explosions
// lodBias         multiplies LOD switch distances

export const PRESETS = {
  low: {
    id: 'low',
    label: 'Low',
    renderScale: 0.75,
    maxPixelRatio: 1,
    shadows: 0,
    post: false,
    bloom: false,
    bloomScale: 0.25,
    particles: 6000,
    debris: 300,
    viewDistance: 9000,
    terrainRes: 160,
    clouds: 40,
    lights: 0,
    lodBias: 0.6,
    antialias: false,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    renderScale: 0.9,
    maxPixelRatio: 1.25,
    shadows: 0,
    post: true,
    bloom: true,
    bloomScale: 0.3,
    particles: 12000,
    debris: 600,
    viewDistance: 13000,
    terrainRes: 256,
    clouds: 90,
    lights: 2,
    lodBias: 0.85,
    antialias: false,
  },
  high: {
    id: 'high',
    label: 'High',
    renderScale: 1,
    maxPixelRatio: 1.5,
    shadows: 1024,
    post: true,
    bloom: true,
    bloomScale: 0.4,
    particles: 24000,
    debris: 1000,
    viewDistance: 18000,
    terrainRes: 384,
    clouds: 150,
    lights: 3,
    lodBias: 1,
    antialias: false,
  },
  ultra: {
    id: 'ultra',
    label: 'Ultra',
    renderScale: 1,
    maxPixelRatio: 2,
    shadows: 2048,
    post: true,
    bloom: true,
    bloomScale: 0.5,
    particles: 40000,
    debris: 1600,
    viewDistance: 24000,
    terrainRes: 512,
    clouds: 220,
    lights: 4,
    lodBias: 1.4,
    antialias: false,
  },
};

export const PRESET_ORDER = ['low', 'medium', 'high', 'ultra'];

function probeGPU() {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return null;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { renderer, maxTex };
  } catch {
    return null;
  }
}

/** Picks a preset from the GPU string and device hints. */
export function detectPreset() {
  const gpu = probeGPU();
  if (!gpu) return { preset: 'low', gpu: 'unknown (no WebGL2)' };
  const r = gpu.renderer.toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|basic render/.test(r)) return { preset: 'low', gpu: gpu.renderer };
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const integrated = /intel|uhd|iris|mali|adreno|powervr|videocore|apple m1(?! (pro|max|ultra))/.test(r);
  const discrete = /nvidia|geforce|rtx|gtx|radeon rx|radeon pro|apple m[1-4] (pro|max|ultra)|arc a/.test(r);
  let score = 2;
  if (discrete) score += 1.2;
  if (integrated) score -= 0.6;
  if (cores <= 4) score -= 0.5;
  if (cores >= 12) score += 0.3;
  if (memory <= 4) score -= 0.5;
  if (gpu.maxTex < 8192) score -= 0.5;
  const preset = score >= 3 ? 'ultra' : score >= 2.2 ? 'high' : score >= 1.2 ? 'medium' : 'low';
  return { preset, gpu: gpu.renderer };
}
