// Default control bindings. Every action can be remapped in Settings → Controls.
//
// Binding codes:
//   Keyboard  KeyboardEvent.code, e.g. 'KeyW', 'ArrowUp', 'Space', 'ShiftLeft'
//   Mouse     'Mouse0' (left), 'Mouse1' (middle), 'Mouse2' (right), 'WheelUp', 'WheelDown'
//   Gamepad   'Pad:B<n>' button n, 'Pad:A<n>+' / 'Pad:A<n>-' axis n direction
//             (standard mapping: A0/A1 left stick, A2/A3 right stick, B6/B7 triggers)
//
// Flying: arrow keys pitch and roll, W/S throttle, A/D rudder, the mouse aims.
// Left mouse fires the gun, right mouse fires the selected missile/weapon.

export const ACTIONS = [
  // [id, label, group]
  ['pitchUp', 'Pitch up (nose up)', 'Flight'],
  ['pitchDown', 'Pitch down (nose down)', 'Flight'],
  ['rollLeft', 'Roll left', 'Flight'],
  ['rollRight', 'Roll right', 'Flight'],
  ['yawLeft', 'Rudder left', 'Flight'],
  ['yawRight', 'Rudder right', 'Flight'],
  ['throttleUp', 'Throttle up', 'Flight'],
  ['throttleDown', 'Throttle down', 'Flight'],
  ['afterburner', 'Afterburner (hold)', 'Flight'],
  ['airbrake', 'Airbrake (hold)', 'Flight'],
  ['autoLevel', 'Toggle auto-level assist', 'Flight'],
  ['mouseAim', 'Toggle mouse-aim mode', 'Flight'],
  ['fireGun', 'Fire gun', 'Weapons'],
  ['fireSecondary', 'Fire selected weapon', 'Weapons'],
  ['nextWeapon', 'Next weapon', 'Weapons'],
  ['prevWeapon', 'Previous weapon', 'Weapons'],
  ['slot1', 'Select weapon slot 1', 'Weapons'],
  ['slot2', 'Select weapon slot 2', 'Weapons'],
  ['slot3', 'Select weapon slot 3', 'Weapons'],
  ['nextTarget', 'Next target', 'Weapons'],
  ['flares', 'Flares', 'Defence'],
  ['defense', 'Defence system (chaff / ECM / shield)', 'Defence'],
  ['wingAttack', 'Wingman: attack my target', 'Wingman'],
  ['wingCover', 'Wingman: cover me', 'Wingman'],
  ['wingRegroup', 'Wingman: regroup', 'Wingman'],
  ['camera', 'Cycle camera', 'View'],
  ['lookLeft', 'Look left', 'View'],
  ['lookRight', 'Look right', 'View'],
  ['lookUp', 'Look up', 'View'],
  ['lookDown', 'Look down', 'View'],
  ['radarZoom', 'Radar range', 'View'],
  ['pause', 'Pause menu', 'System'],
];

export const DEFAULT_BINDINGS = {
  pitchUp: ['ArrowUp', 'Pad:A1+'],
  pitchDown: ['ArrowDown', 'Pad:A1-'],
  rollLeft: ['ArrowLeft', 'Pad:A0-'],
  rollRight: ['ArrowRight', 'Pad:A0+'],
  yawLeft: ['KeyA', 'Pad:B4'],
  yawRight: ['KeyD', 'Pad:B5'],
  throttleUp: ['KeyW', 'Pad:B7'],
  throttleDown: ['KeyS', 'Pad:B6'],
  afterburner: ['ShiftLeft', 'ShiftRight', 'Pad:B10'],
  airbrake: ['KeyB', 'Pad:B11'],
  autoLevel: ['KeyL'],
  mouseAim: ['KeyM'],
  fireGun: ['Mouse0', 'Space', 'Pad:B0'],
  fireSecondary: ['Mouse2', 'KeyF', 'Pad:B1'],
  nextWeapon: ['KeyR', 'WheelDown', 'Pad:B3'],
  prevWeapon: ['WheelUp'],
  slot1: ['Digit1'],
  slot2: ['Digit2'],
  slot3: ['Digit3'],
  nextTarget: ['KeyT', 'Mouse1', 'Pad:B2'],
  flares: ['KeyX', 'Pad:B13'],
  defense: ['KeyV', 'Pad:B12'],
  wingAttack: ['KeyZ', 'Pad:B14'],
  wingCover: ['KeyG', 'Pad:B15'],
  wingRegroup: ['KeyH'],
  camera: ['KeyC', 'Pad:B8'],
  lookLeft: ['Numpad4', 'Pad:A2-'],
  lookRight: ['Numpad6', 'Pad:A2+'],
  lookUp: ['Numpad8', 'Pad:A3-'],
  lookDown: ['Numpad2', 'Pad:A3+'],
  radarZoom: ['KeyN'],
  pause: ['Escape', 'KeyP', 'Pad:B9'],
};

export function describeCode(code) {
  if (!code) return '—';
  if (code.startsWith('Pad:B')) {
    const names = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'D-Up', 'D-Down', 'D-Left', 'D-Right', 'Home'];
    const n = +code.slice(5);
    return 'Pad ' + (names[n] ?? 'B' + n);
  }
  if (code.startsWith('Pad:A')) {
    const n = +code.slice(5, -1);
    const dir = code.endsWith('+') ? '+' : '−';
    const names = ['LS X', 'LS Y', 'RS X', 'RS Y'];
    return 'Pad ' + (names[n] ?? 'Axis ' + n) + dir;
  }
  if (code.startsWith('Mouse')) return ['LMB', 'MMB', 'RMB', 'Mouse 4', 'Mouse 5'][+code.slice(5)] ?? code;
  if (code === 'WheelUp') return 'Wheel ↑';
  if (code === 'WheelDown') return 'Wheel ↓';
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace(/^Arrow(.*)/, (_, d) => ({ Up: '↑', Down: '↓', Left: '←', Right: '→' })[d])
    .replace('Left', ' L')
    .replace('Right', ' R');
}
