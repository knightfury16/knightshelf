/**
 * Haptic feedback for touch.
 *
 * A phone gives no visual click, so a press that saves a word and a press that missed
 * feel identical. A 10ms pulse closes that gap.
 *
 * Intents rather than durations, so the vocabulary stays in one place and a caller never
 * has to decide what "18" means. Three is deliberately the whole set: a fourth would be
 * a distinction nobody can feel.
 *
 * Support is narrower than it looks. `navigator.vibrate` works on Chrome for Android —
 * which is the device this app is actually used on — and does not exist at all on iOS
 * Safari. It also does nothing when Android's own touch-vibration setting is off, while
 * still returning `true`, so a successful call is no evidence of a pulse. Everything
 * here degrades to a no-op rather than guarding at each call site.
 *
 * Not coupled to `prefers-reduced-motion`: that setting is about visual motion, and
 * someone who wants fewer animations has not necessarily asked for a silent phone. This
 * has its own switch in Settings.
 */

export type HapticIntent = 'tap' | 'commit' | 'warn';

/** Milliseconds, or an on/off/on pattern. Short enough to read as a click, not a buzz. */
const PATTERNS: Record<HapticIntent, number | number[]> = {
  tap: 10,
  commit: 18,
  warn: [12, 60, 12],
};

/** Higher outranks lower when two pulses land close together. */
const RANK: Record<HapticIntent, number> = { tap: 1, commit: 2, warn: 3 };

/**
 * Below this, a second pulse of the same or lower rank is dropped.
 *
 * A press that also commits fires twice — once from the global pointer listener, once
 * from the handler — and two pulses inside the same gesture read as one long buzz. The
 * rank check still lets a `commit` follow its own `tap` immediately, which is the one
 * case where two distinct pulses are the point.
 */
const SUPPRESS_MS = 40;

export interface HapticsIO {
  /** `navigator.vibrate`, or null where the API is absent. */
  vibrate: ((pattern: number | number[]) => boolean) | null;
  now: () => number;
  isEnabled: () => boolean;
}

export interface Haptics {
  /** Returns whether a pulse was actually requested. */
  fire: (intent: HapticIntent) => boolean;
}

export function createHaptics(io: HapticsIO): Haptics {
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastRank = 0;

  return {
    fire(intent) {
      if (!io.vibrate || !io.isEnabled()) return false;

      const at = io.now();
      const rank = RANK[intent];
      if (at - lastAt < SUPPRESS_MS && rank <= lastRank) return false;

      lastAt = at;
      lastRank = rank;
      io.vibrate(PATTERNS[intent]);
      return true;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* The preference                                                             */
/* -------------------------------------------------------------------------- */

const STORAGE_KEY = 'knightshelf.haptics';

/** Absent means on, so the feature is there without being asked for. */
export function readHapticsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    // Storage blocked (private mode); default to on for the session.
    return true;
  }
}

function browserVibrate(): ((pattern: number | number[]) => boolean) | null {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return null;
  return (pattern) => navigator.vibrate(pattern);
}

/** False on iOS and on any desktop browser without the API. Hides the Settings row. */
export function hapticsSupported(): boolean {
  return browserVibrate() !== null;
}

let preference: boolean | null = null;

export function hapticsEnabled(): boolean {
  preference ??= readHapticsEnabled();
  return preference;
}

export function setHapticsEnabled(enabled: boolean): void {
  preference = enabled;
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, 'off');
  } catch {
    // Non-fatal: the choice still holds for this session.
  }
}

const shared = createHaptics({
  vibrate: browserVibrate(),
  now: () => performance.now(),
  isEnabled: hapticsEnabled,
});

/** Any press. Fired centrally by `installTapHaptics`, so handlers rarely call it. */
export function tap(): void {
  shared.fire('tap');
}

/** Something was kept: a word saved, a star set, a definition refreshed. */
export function commit(): void {
  shared.fire('commit');
}

/** Something needs a second look: a delete armed, a lookup that failed. */
export function warn(): void {
  shared.fire('warn');
}

/* -------------------------------------------------------------------------- */
/* Wiring                                                                     */
/* -------------------------------------------------------------------------- */

const INTERACTIVE = 'button, a[href], [role="button"], summary';

/**
 * One listener for every press in the app.
 *
 * Reaching into forty click handlers would work today and drift the moment anyone adds
 * a button. Delegation at the root cannot fall out of step, and it covers the sheets,
 * the tab bar and the lookup row without any of them knowing.
 *
 * `pointerdown` rather than `pointerup`, because feedback that arrives on release feels
 * like lag. The cost is a stray pulse when a press on a button turns into a scroll,
 * which is 10ms and rare.
 */
export function installTapHaptics(root: Document = document): () => void {
  function onPointerDown(event: PointerEvent): void {
    const origin = event.target;
    if (!(origin instanceof Element)) return;

    const control = origin.closest(INTERACTIVE);
    // A press that does nothing should feel like nothing.
    if (!control || control.matches(':disabled')) return;
    if (control.getAttribute('aria-disabled') === 'true') return;

    tap();
  }

  root.addEventListener('pointerdown', onPointerDown, { passive: true });
  return () => root.removeEventListener('pointerdown', onPointerDown);
}
