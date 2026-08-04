import { describe, expect, it } from 'vitest';
import {
  indexOfKeptSense,
  isTrimmed,
  keptSense,
  senseForRecord,
  synonymsForKeptSense,
  trimWord,
  trimWords,
} from './senses';
import type { Sense, Word } from '../types';

/**
 * This module defines what a stored word is, and the merge depends on every device
 * agreeing on that shape. A mistake here reintroduces the exact bug the trimming was
 * designed to prevent: records differing only because one device trimmed and another
 * did not, letting a sync strip data.
 */

const bedCloth: Sense = {
  partOfSpeech: 'noun',
  definition: 'A thin bed cloth.',
  example: 'Use the sheets in the hall closet.',
  synonyms: ['bedsheet', 'linen'],
};

const rope: Sense = {
  partOfSpeech: 'noun',
  definition: 'A rope controlling a sail.',
  synonyms: ['line', 'halyard'],
};

function word(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    bookId: 'b1',
    term: 'sheet',
    senses: [bedCloth, rope],
    primarySense: 1,
    starred: false,
    lookupState: 'resolved',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('keptSense', () => {
  it('returns the sense the reader chose, not the first', () => {
    expect(keptSense(word())?.definition).toBe('A rope controlling a sail.');
  });

  it('falls back to the first when the index is out of range', () => {
    expect(keptSense(word({ primarySense: 9 }))?.definition).toBe('A thin bed cloth.');
  });

  it('returns nothing when there are no senses', () => {
    expect(keptSense(word({ senses: [], primarySense: 0 }))).toBeUndefined();
  });
});

describe('senseForRecord', () => {
  it('drops synonyms, which no record ever displays', () => {
    expect(senseForRecord(bedCloth).synonyms).toBeUndefined();
  });

  it('keeps the example, which the entry does display', () => {
    expect(senseForRecord(bedCloth).example).toBe('Use the sheets in the hall closet.');
  });

  it('omits the example key entirely when there is none', () => {
    expect('example' in senseForRecord(rope)).toBe(false);
  });

  it('keeps the part of speech and definition', () => {
    expect(senseForRecord(rope)).toEqual({
      partOfSpeech: 'noun',
      definition: 'A rope controlling a sail.',
    });
  });
});

describe('trimWord', () => {
  it('reduces a full dictionary record to the chosen sense', () => {
    const trimmed = trimWord(word());
    expect(trimmed.senses).toHaveLength(1);
    expect(trimmed.senses[0].definition).toBe('A rope controlling a sail.');
    expect(trimmed.primarySense).toBe(0);
  });

  it('strips synonyms from the sense it keeps', () => {
    expect(trimWord(word()).senses[0].synonyms).toBeUndefined();
  });

  it('leaves everything the reader supplied untouched', () => {
    const original = word({
      contextSentence: 'He hauled the sheet taut.',
      page: '114',
      note: 'nautical',
      starred: true,
    });
    const trimmed = trimWord(original);

    expect(trimmed.contextSentence).toBe('He hauled the sheet taut.');
    expect(trimmed.page).toBe('114');
    expect(trimmed.note).toBe('nautical');
    expect(trimmed.starred).toBe(true);
    expect(trimmed.term).toBe('sheet');
    expect(trimmed.addedAt).toBe(original.addedAt);
    // Trimming is a shape change, never an edit — bumping this would trigger a push
    // and could win over a genuinely newer edit on another device.
    expect(trimmed.updatedAt).toBe(original.updatedAt);
  });

  it('is idempotent', () => {
    const once = trimWord(word());
    const twice = trimWord(once);
    expect(twice).toEqual(once);
  });

  it('returns the very same object when already trimmed, so no needless write happens', () => {
    const already = trimWord(word());
    // Identity, not equality: callers skip writes on an unchanged reference.
    expect(trimWord(already)).toBe(already);
  });

  it('copes with a word that has no senses at all', () => {
    const pending = word({ senses: [], primarySense: 0, lookupState: 'pending' });
    expect(trimWord(pending).senses).toEqual([]);
    expect(trimWord(pending)).toBe(pending);
  });

  it('normalises an out-of-range index rather than leaving it dangling', () => {
    const trimmed = trimWord(word({ primarySense: 9 }));
    expect(trimmed.primarySense).toBe(0);
    expect(trimmed.senses).toHaveLength(1);
  });
});

describe('isTrimmed', () => {
  it.each([
    ['a full dictionary record', word(), false],
    ['a record whose only sense still has synonyms', word({ senses: [rope], primarySense: 0 }), false],
    ['a record with a non-zero index', word({ senses: [senseForRecord(rope)], primarySense: 1 }), false],
    ['a correctly trimmed record', word({ senses: [senseForRecord(rope)], primarySense: 0 }), true],
    ['a record with no senses', word({ senses: [], primarySense: 0 }), true],
  ])('reports %s as %s', (_label, subject, expected) => {
    expect(isTrimmed(subject)).toBe(expected);
  });
});

describe('trimWords', () => {
  it('trims a collection and leaves already-trimmed entries identical', () => {
    const full = word();
    const already = trimWord(word({ id: 'w2' }));
    const [first, second] = trimWords([full, already]);

    expect(first.senses).toHaveLength(1);
    expect(second).toBe(already);
  });
});

describe('indexOfKeptSense', () => {
  const trimmed = trimWord(word());

  it('finds the kept sense among cached candidates', () => {
    expect(indexOfKeptSense(trimmed, [bedCloth, rope])).toBe(1);
  });

  it('follows the sense when the dictionary reorders its list', () => {
    // An index would now be pointing at the wrong meaning; the text still matches.
    expect(indexOfKeptSense(trimmed, [rope, bedCloth])).toBe(0);
  });

  it('reports no match when the cache holds nothing useful', () => {
    expect(indexOfKeptSense(trimmed, [])).toBe(-1);
    expect(indexOfKeptSense(trimmed, [bedCloth])).toBe(-1);
  });
});

describe('synonymsForKeptSense', () => {
  const trimmed = trimWord(word());

  it('reads synonyms from the cache, since the record no longer carries them', () => {
    expect(synonymsForKeptSense(trimmed, [bedCloth, rope])).toEqual(['line', 'halyard']);
  });

  it('returns nothing when the cache is empty or the sense is absent', () => {
    expect(synonymsForKeptSense(trimmed, [])).toEqual([]);
    expect(synonymsForKeptSense(trimmed, [bedCloth])).toEqual([]);
  });

  it('returns nothing when the matched sense simply has no synonyms', () => {
    const plain: Sense = { partOfSpeech: 'noun', definition: 'A rope controlling a sail.' };
    expect(synonymsForKeptSense(trimmed, [plain])).toEqual([]);
  });
});
