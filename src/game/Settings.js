import { DEFAULT_BINDINGS } from '../config/controls.js';

// User settings with defaults; stored inside the save file.

export const DEFAULT_SETTINGS = {
  quality: 'auto', // auto | low | medium | high | ultra
  renderScale: 0, // 0 = use preset
  adaptive: true,
  targetFps: 60,
  masterVolume: 0.8,
  sfxVolume: 1,
  engineVolume: 0.7,
  radioVolume: 0.9,
  musicVolume: 0.4,
  voice: false, // offline speech synthesis for radio lines
  mouseSensitivity: 1,
  invertY: false,
  mouseAim: true,
  autoLevel: true,
  damageNumbers: true,
  killCam: true,
  difficulty: 'normal',
  showFps: false,
  pilotName: 'MAVERICK',
  bindings: null,
};

export function loadSettings(save) {
  const s = { ...DEFAULT_SETTINGS, ...(save.data.settings || {}) };
  if (!s.bindings) s.bindings = structuredClone(DEFAULT_BINDINGS);
  for (const k of Object.keys(DEFAULT_BINDINGS)) if (!s.bindings[k]) s.bindings[k] = [...DEFAULT_BINDINGS[k]];
  save.data.settings = s;
  return s;
}
