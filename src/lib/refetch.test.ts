import { describe, expect, it } from 'vitest';
import { refetchMessageFor, type RefetchOutcome } from './refetch';

const OUTCOMES: RefetchOutcome[] = ['updated', 'notfound', 'unavailable', 'missing'];

describe('refetchMessageFor', () => {
  it('answers for every outcome, in both contexts', () => {
    for (const outcome of OUTCOMES) {
      for (const saved of [true, false]) {
        const message = refetchMessageFor(outcome, { saved });
        expect(message.text.length).toBeGreaterThan(0);
        expect(['ok', 'bad']).toContain(message.tone);
      }
    }
  });

  it('treats only a refreshed definition as good news', () => {
    for (const outcome of OUTCOMES) {
      const expected = outcome === 'updated' ? 'ok' : 'bad';
      expect(refetchMessageFor(outcome, { saved: true }).tone).toBe(expected);
    }
  });

  /**
   * The reason this helper exists. "Your word is safe" reassures you about a record in
   * the shelf and misleads you about one still sitting in an unsaved form.
   */
  it('never claims an unsaved word is safe', () => {
    for (const outcome of OUTCOMES) {
      const draft = refetchMessageFor(outcome, { saved: false }).text;
      expect(draft).not.toMatch(/is safe|untouched/i);
    }
  });

  it('tells a saved word it is safe when the network failed', () => {
    expect(refetchMessageFor('unavailable', { saved: true }).text).toMatch(/safe/i);
  });

  it('tells an unsaved word to save now when the network failed', () => {
    expect(refetchMessageFor('unavailable', { saved: false }).text).toMatch(/save it now/i);
  });

  it('says the same thing about success either way', () => {
    expect(refetchMessageFor('updated', { saved: true })).toEqual(
      refetchMessageFor('updated', { saved: false }),
    );
  });
});
