import { describe, expect, it } from 'vitest';
import { createHaptics, type HapticIntent } from './haptics';

/**
 * The core is a pure function of (support, preference, clock), so these run with no DOM
 * and no real vibration hardware. `installTapHaptics` needs a document and is exercised
 * in the browser instead.
 */

function harness(options: { supported?: boolean; enabled?: boolean } = {}) {
  const { supported = true, enabled = true } = options;
  const calls: (number | number[])[] = [];
  let clock = 1000;

  const haptics = createHaptics({
    vibrate: supported
      ? (pattern) => {
          calls.push(pattern);
          return true;
        }
      : null,
    now: () => clock,
    isEnabled: () => enabled,
  });

  return {
    calls,
    advance: (ms: number) => {
      clock += ms;
    },
    fire: (intent: HapticIntent) => haptics.fire(intent),
  };
}

describe('createHaptics', () => {
  it('pulses for each intent', () => {
    const h = harness();

    expect(h.fire('tap')).toBe(true);
    h.advance(500);
    expect(h.fire('commit')).toBe(true);
    h.advance(500);
    expect(h.fire('warn')).toBe(true);

    expect(h.calls).toEqual([10, 18, [12, 60, 12]]);
  });

  it('does nothing where the API is absent', () => {
    const h = harness({ supported: false });

    expect(h.fire('tap')).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('does nothing when the preference is off', () => {
    const h = harness({ enabled: false });

    expect(h.fire('commit')).toBe(false);
    expect(h.calls).toEqual([]);
  });

  /**
   * Two pulses inside one gesture read as a single long buzz rather than two clicks,
   * which is worse than one clean pulse.
   */
  it('drops a repeat of the same intent within the suppression window', () => {
    const h = harness();

    expect(h.fire('tap')).toBe(true);
    h.advance(10);
    expect(h.fire('tap')).toBe(false);

    expect(h.calls).toEqual([10]);
  });

  /**
   * The case that matters: the root listener fires `tap` on pointerdown and the handler
   * fires `commit` a moment later. The commit is the informative one, so it must survive
   * its own tap.
   */
  it('lets a higher-ranked intent through immediately', () => {
    const h = harness();

    expect(h.fire('tap')).toBe(true);
    h.advance(5);
    expect(h.fire('commit')).toBe(true);
    h.advance(5);
    expect(h.fire('warn')).toBe(true);

    expect(h.calls).toEqual([10, 18, [12, 60, 12]]);
  });

  it('does not let a lower-ranked intent follow a higher one', () => {
    const h = harness();

    expect(h.fire('warn')).toBe(true);
    h.advance(5);
    expect(h.fire('tap')).toBe(false);
    expect(h.fire('commit')).toBe(false);

    expect(h.calls).toEqual([[12, 60, 12]]);
  });

  it('allows the same intent again once the window has passed', () => {
    const h = harness();

    expect(h.fire('tap')).toBe(true);
    h.advance(41);
    expect(h.fire('tap')).toBe(true);

    expect(h.calls).toEqual([10, 10]);
  });

  /** Rank gating must not outlive the window, or a warn would mute taps for ever. */
  it('forgets the previous rank once the window has passed', () => {
    const h = harness();

    h.fire('warn');
    h.advance(41);

    expect(h.fire('tap')).toBe(true);
  });
});
