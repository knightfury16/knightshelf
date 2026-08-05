import { describe, expect, it } from 'vitest';
import type { Book, Word } from '../types';
import {
  countBookChanges,
  countWordChanges,
  legacyRetiredMessage,
  manifestCommitMessage,
  sanitizeForCommit,
  shardCommitMessage,
} from './commitMessages';

const NEWLINE = String.fromCharCode(10);
const CARRIAGE_RETURN = String.fromCharCode(13);
const NUL = String.fromCharCode(0);
const BELL = String.fromCharCode(7);
const LINE_SEPARATOR = String.fromCharCode(0x2028);

function word(id: string, over: Partial<Word> = {}): Word {
  return {
    id,
    bookId: 'book-1',
    term: id,
    senses: [{ partOfSpeech: 'noun', definition: `meaning of ${id}` }],
    primarySense: 0,
    starred: false,
    lookupState: 'resolved',
    addedAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function book(id: string, over: Partial<Book> = {}): Book {
  return {
    id,
    title: `Title ${id}`,
    status: 'reading',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

describe('sanitizeForCommit', () => {
  it('leaves ordinary text alone', () => {
    expect(sanitizeForCommit('Moby Dick', 48)).toBe('Moby Dick');
  });

  it('collapses whitespace runs and trims', () => {
    expect(sanitizeForCommit('  Moby    Dick  ', 48)).toBe('Moby Dick');
  });

  it('turns a newline into a space rather than joining the words', () => {
    expect(sanitizeForCommit(`Moby${NEWLINE}Dick`, 48)).toBe('Moby Dick');
  });

  it.each([
    ['a newline', NEWLINE],
    ['a carriage return', CARRIAGE_RETURN],
    ['a NUL', NUL],
    ['a bell', BELL],
    ['a Unicode line separator', LINE_SEPARATOR],
  ])('strips %s', (_label, character) => {
    const result = sanitizeForCommit(`before${character}after`, 48);
    expect(result).toBe('before after');
  });

  it('truncates with an ellipsis', () => {
    expect(sanitizeForCommit('abcdefghij', 5)).toBe('abcd…');
  });

  it('keeps text exactly at the limit', () => {
    expect(sanitizeForCommit('abcde', 5)).toBe('abcde');
  });

  it('keeps astral characters whole when truncating is not needed', () => {
    expect(sanitizeForCommit('a 𝔊 b', 48)).toBe('a 𝔊 b');
  });
});

describe('countWordChanges', () => {
  it('counts everything as added when the file does not exist yet', () => {
    expect(countWordChanges([word('a'), word('b')], undefined)).toEqual({ added: 2, updated: 0 });
  });

  it('reports nothing when both sides match', () => {
    const words = [word('a'), word('b')];
    expect(countWordChanges(words, words)).toEqual({ added: 0, updated: 0 });
  });

  it('separates new words from changed ones', () => {
    const previous = [word('a'), word('b')];
    const next = [word('a'), word('b', { note: 'edited' }), word('c')];

    expect(countWordChanges(next, previous)).toEqual({ added: 1, updated: 1 });
  });

  it('ignores a word that only moved position', () => {
    const previous = [word('a'), word('b')];
    expect(countWordChanges([word('b'), word('a')], previous)).toEqual({ added: 0, updated: 0 });
  });

  /** Deletes are soft, so a removal arrives as a record with a tombstone on it. */
  it('counts a soft delete as an update, not a removal', () => {
    const previous = [word('a')];
    const next = [word('a', { deletedAt: '2026-08-02T00:00:00.000Z' })];

    expect(countWordChanges(next, previous)).toEqual({ added: 0, updated: 1 });
  });
});

describe('countBookChanges', () => {
  it('reports new books', () => {
    const changes = countBookChanges([book('a'), book('b')], [book('a')]);

    expect(changes.added.map((entry) => entry.id)).toEqual(['b']);
    expect(changes.removed).toEqual([]);
  });

  it('reports a book whose tombstone just appeared', () => {
    const previous = [book('a')];
    const next = [book('a', { deletedAt: '2026-08-02T00:00:00.000Z' })];

    expect(countBookChanges(next, previous).removed.map((entry) => entry.id)).toEqual(['a']);
  });

  it('does not re-report a book that was already deleted', () => {
    const deleted = book('a', { deletedAt: '2026-08-02T00:00:00.000Z' });

    expect(countBookChanges([deleted], [deleted])).toEqual({ added: [], removed: [] });
  });

  it('treats a book that arrives already deleted as a removal', () => {
    const deleted = book('a', { deletedAt: '2026-08-02T00:00:00.000Z' });

    expect(countBookChanges([deleted], []).removed.map((entry) => entry.id)).toEqual(['a']);
    expect(countBookChanges([deleted], []).added).toEqual([]);
  });
});

describe('shardCommitMessage', () => {
  it.each([
    [{ added: 3, updated: 0 }, 'Brave Otter — 3 words added to Moby Dick'],
    [{ added: 1, updated: 0 }, 'Brave Otter — 1 word added to Moby Dick'],
    [{ added: 0, updated: 2 }, 'Brave Otter — 2 words updated in Moby Dick'],
    [{ added: 0, updated: 1 }, 'Brave Otter — 1 word updated in Moby Dick'],
    [{ added: 3, updated: 2 }, 'Brave Otter — 3 words added, 2 updated in Moby Dick'],
  ])('describes %j', (counts, expected) => {
    expect(
      shardCommitMessage({ deviceName: 'Brave Otter', bookTitle: 'Moby Dick', ...counts }),
    ).toBe(expected);
  });

  it('still says something when no counts moved', () => {
    expect(
      shardCommitMessage({
        deviceName: 'Brave Otter',
        bookTitle: 'Moby Dick',
        added: 0,
        updated: 0,
      }),
    ).toBe('Brave Otter — words updated in Moby Dick');
  });

  it('falls back when the book is unknown', () => {
    expect(shardCommitMessage({ deviceName: 'Brave Otter', added: 1, updated: 0 })).toBe(
      'Brave Otter — 1 word added to an unfiled book',
    );
  });

  it('falls back when the title is blank', () => {
    expect(
      shardCommitMessage({ deviceName: 'Brave Otter', bookTitle: '   ', added: 1, updated: 0 }),
    ).toBe('Brave Otter — 1 word added to an unfiled book');
  });

  it('names the device even when none was supplied', () => {
    expect(shardCommitMessage({ bookTitle: 'Moby Dick', added: 1, updated: 0 })).toBe(
      'An unnamed device — 1 word added to Moby Dick',
    );
  });

  it('truncates a very long title', () => {
    const message = shardCommitMessage({
      deviceName: 'Brave Otter',
      bookTitle: 'A'.repeat(120),
      added: 1,
      updated: 0,
    });

    expect(message).toContain('…');
    expect(message.length).toBeLessThan(120);
  });
});

/**
 * The reason `sanitizeForCommit` exists. Titles come from Open Library or a free-text
 * field, so without it a title could end the subject line and append a body of its own.
 */
describe('commit message injection', () => {
  it('cannot be broken onto a second line by a book title', () => {
    const message = shardCommitMessage({
      deviceName: 'Brave Otter',
      bookTitle: `Moby Dick${NEWLINE}${NEWLINE}Signed-off-by: someone else`,
      added: 1,
      updated: 0,
    });

    expect(message).not.toContain(NEWLINE);
    expect(message.split(NEWLINE)).toHaveLength(1);
  });

  it('cannot be broken onto a second line by a device name', () => {
    const message = shardCommitMessage({
      deviceName: `Brave Otter${CARRIAGE_RETURN}${NEWLINE}malicious`,
      bookTitle: 'Moby Dick',
      added: 1,
      updated: 0,
    });

    expect(message).not.toContain(NEWLINE);
    expect(message).not.toContain(CARRIAGE_RETURN);
  });

  it('holds for the manifest message too', () => {
    const message = manifestCommitMessage({
      deviceName: 'Brave Otter',
      added: [book('a', { title: `Dune${NEWLINE}injected` })],
      removed: [],
    });

    expect(message).not.toContain(NEWLINE);
  });
});

describe('manifestCommitMessage', () => {
  const device = 'Brave Otter';

  it('names a single new book', () => {
    expect(
      manifestCommitMessage({ deviceName: device, added: [book('a', { title: 'Dune' })], removed: [] }),
    ).toBe('Brave Otter — Dune added to the shelf');
  });

  it('counts several new books', () => {
    expect(
      manifestCommitMessage({ deviceName: device, added: [book('a'), book('b')], removed: [] }),
    ).toBe('Brave Otter — 2 books added to the shelf');
  });

  it('names a single removed book', () => {
    expect(
      manifestCommitMessage({ deviceName: device, added: [], removed: [book('a', { title: 'Dune' })] }),
    ).toBe('Brave Otter — Dune removed from the shelf');
  });

  it('counts several removed books', () => {
    expect(
      manifestCommitMessage({ deviceName: device, added: [], removed: [book('a'), book('b')] }),
    ).toBe('Brave Otter — 2 books removed from the shelf');
  });

  it('reports both directions at once', () => {
    expect(
      manifestCommitMessage({
        deviceName: device,
        added: [book('a')],
        removed: [book('b'), book('c')],
      }),
    ).toBe('Brave Otter — 1 book added, 2 removed from the shelf');
  });

  /**
   * The common case by far: the manifest is rewritten whenever any book's revision moves,
   * so most of its commits carry no news and must not pretend otherwise.
   */
  it('stays quiet when only revisions moved', () => {
    expect(manifestCommitMessage({ deviceName: device, added: [], removed: [] })).toBe(
      'Brave Otter — index updated',
    );
  });
});

describe('legacyRetiredMessage', () => {
  it('names the device that performed the migration', () => {
    expect(legacyRetiredMessage('Brave Otter')).toBe('Brave Otter — moved to per-book files');
  });

  it('works without a device name', () => {
    expect(legacyRetiredMessage()).toBe('An unnamed device — moved to per-book files');
  });
});
