// Device facts used to adapt controls and graphics.
//
// IS_APP    running inside the Android app (mobile-game/, Capacitor)
// IS_TOUCH  phone or tablet: touch is the main input (no fine mouse pointer)

export const IS_APP = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();

function detectTouch() {
  if (typeof window === 'undefined') return false;
  if (IS_APP) return true;
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const fine = window.matchMedia?.('(any-pointer: fine)').matches;
  return !!coarse && !fine && (navigator.maxTouchPoints || 0) > 0;
}

export const IS_TOUCH = detectTouch();

/** Short haptic tick on phones that support it. */
export function buzz(ms = 12) {
  if (!IS_TOUCH) return;
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed */
  }
}
