import { describe, expect, it } from 'vitest';
import { isRemoteVersionSupported, mergeLibraries, stableStringify } from './merge';
import { SCHEMA_VERSION, type Book, type LibraryData, type Word } from '../types';

/**
 * The merge is the only place in this app where a bug destroys data permanently, so
 * these tests lean on the two structural properties rather than on examples alone:
 * symmetry (two devices agree on the outcome) and idempotence (a retried sync is a
 * no-op). Without symmetry the devices ping-pong forever.
 */

function book(over: Partial<Book> = {}): Book {
  return {
    id: 'b1',
    title: 'Blood Meridian',
    status: 'reading',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function word(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    bookId: 'b1',
    term: 'gunwale',
    senses: [{ partOfSpeech: 'noun', definition: 'The top edge of a hull.' }],
    primarySense: 0,
    starred: false,
    lookupState: 'resolved',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function library(books: Book[] = [], words: Word[] = []): LibraryData {
  return { version: SCHEMA_VERSION, books, words };
}

const empty = (): LibraryData => library();

describe('stableStringify', () => {
  it('ignores key order, so a JSON round-trip is not seen as a change', () => {
    const a = { alpha: 1, beta: { x: 1, y: 2 } };
    const b = { beta: { y: 2, x: 1 }, alpha: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('preserves array order, which is meaningful for senses', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('treats an absent key and an undefined value alike', () => {
    expect(stableStringify({ a: 1, b: undefined })).toBe(stableStringify({ a: 1 }));
  });
});

describe('mergeLibraries — first contact', () => {
  it('pushes everything when the remote file does not exist yet', () => {
    const local = library([book()], [word()]);
    const result = mergeLibraries(local, empty());

    expect(result.merged.words).toHaveLength(1);
    expect(result.changedRemote).toBe(true);
    expect(result.changedLocal).toBe(false);
  });

  it('adopts everything on a brand new device', () => {
    const remote = library([book()], [word()]);
    const result = mergeLibraries(empty(), remote);

    expect(result.merged.words).toHaveLength(1);
    expect(result.changedLocal).toBe(true);
    expect(result.changedRemote).toBe(false);
    expect(result.stats.wordsAdded).toBe(1);
    expect(result.stats.booksAdded).toBe(1);
  });

  it('reports no change at all when both sides already agree', () => {
    const local = library([book()], [word()]);
    const result = mergeLibraries(local, library([book()], [word()]));

    expect(result.changedLocal).toBe(false);
    expect(result.changedRemote).toBe(false);
  });

  it('is not fooled by differing key order', () => {
    const reorder = <T extends object>(value: T): T =>
      Object.fromEntries(Object.entries(value).reverse()) as T;

    const local = library([book()], [word()]);
    const remote = library([reorder(book())], [reorder(word())]);

    // A spurious difference here would push on every single sync, forever.
    const result = mergeLibraries(local, remote);
    expect(result.changedLocal).toBe(false);
    expect(result.changedRemote).toBe(false);
  });
});

describe('mergeLibraries — combining edits', () => {
  it('unions words captured independently on two devices', () => {
    const local = library([book()], [word({ id: 'w1', term: 'gunwale' })]);
    const remote = library([book()], [word({ id: 'w2', term: 'escarpment' })]);

    const result = mergeLibraries(local, remote);
    expect(result.merged.words.map((w) => w.term).sort()).toEqual(['escarpment', 'gunwale']);
    expect(result.changedLocal).toBe(true);
    expect(result.changedRemote).toBe(true);
  });

  it('keeps the newer edit when both sides changed the same word', () => {
    const local = library([book()], [word({ note: 'local', updatedAt: '2026-05-05T00:00:00.000Z' })]);
    const remote = library([book()], [word({ note: 'remote', updatedAt: '2026-04-04T00:00:00.000Z' })]);

    expect(mergeLibraries(local, remote).merged.words[0].note).toBe('local');
    expect(mergeLibraries(remote, local).merged.words[0].note).toBe('local');
  });

  it('counts an incoming edit as updated rather than added', () => {
    const local = library([book()], [word({ updatedAt: '2026-01-01T00:00:00.000Z' })]);
    const remote = library([book()], [word({ note: 'newer', updatedAt: '2026-06-06T00:00:00.000Z' })]);

    const stats = mergeLibraries(local, remote).stats;
    expect(stats.wordsUpdated).toBe(1);
    expect(stats.wordsAdded).toBe(0);
  });

  it('never loses a record that existed on either side', () => {
    const local = library([book()], [word({ id: 'w1' }), word({ id: 'w2' })]);
    const remote = library(
      [book(), book({ id: 'b2', title: 'Moby Dick' })],
      [word({ id: 'w3' }), word({ id: 'w4', bookId: 'b2' })],
    );

    const result = mergeLibraries(local, remote);
    expect(result.merged.words.map((w) => w.id).sort()).toEqual(['w1', 'w2', 'w3', 'w4']);
    expect(result.merged.books.map((b) => b.id).sort()).toEqual(['b1', 'b2']);
  });
});

describe('mergeLibraries — deletions', () => {
  it('applies a tombstone that arrives from the other device', () => {
    const local = library([book()], [word({ updatedAt: '2026-01-01T00:00:00.000Z' })]);
    const remote = library(
      [book()],
      [word({ deletedAt: '2026-03-03T00:00:00.000Z', updatedAt: '2026-03-03T00:00:00.000Z' })],
    );

    const result = mergeLibraries(local, remote);
    expect(result.merged.words[0].deletedAt).toBe('2026-03-03T00:00:00.000Z');
    expect(result.stats.deletionsApplied).toBe(1);
  });

  it('keeps the tombstone in the payload so it can propagate onwards', () => {
    const local = library(
      [book()],
      [word({ deletedAt: '2026-03-03T00:00:00.000Z', updatedAt: '2026-03-03T00:00:00.000Z' })],
    );

    // Dropping tombstones would let the other device resurrect the word.
    expect(mergeLibraries(local, empty()).merged.words).toHaveLength(1);
  });

  it('lets a later edit win over an earlier delete', () => {
    const local = library([book()], [word({ note: 'edited', updatedAt: '2026-08-08T00:00:00.000Z' })]);
    const remote = library(
      [book()],
      [word({ deletedAt: '2026-07-07T00:00:00.000Z', updatedAt: '2026-07-07T00:00:00.000Z' })],
    );

    const result = mergeLibraries(local, remote);
    expect(result.merged.words[0].deletedAt).toBeUndefined();
    expect(result.merged.words[0].note).toBe('edited');
  });

  it('counts a word left behind by a deleted book instead of discarding it', () => {
    const local = library(
      [book({ deletedAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' })],
      [],
    );
    const remote = library([book()], [word({ updatedAt: '2026-10-10T00:00:00.000Z' })]);

    const result = mergeLibraries(local, remote);
    expect(result.stats.orphanedWords).toBe(1);
    // Present, not deleted: losing it silently would be the worse failure.
    expect(result.merged.words).toHaveLength(1);
  });
});

describe('mergeLibraries — structural guarantees', () => {
  const localSide = library(
    [book(), book({ id: 'b2', title: 'Moby Dick', updatedAt: '2026-02-02T00:00:00.000Z' })],
    [
      word({ id: 'w1', note: 'local', updatedAt: '2026-05-05T00:00:00.000Z' }),
      word({ id: 'w2', term: 'anchorite' }),
    ],
  );

  const remoteSide = library(
    [book({ title: 'Blood Meridian (revised)', updatedAt: '2026-06-06T00:00:00.000Z' })],
    [
      word({ id: 'w1', note: 'remote', updatedAt: '2026-04-04T00:00:00.000Z' }),
      word({ id: 'w3', term: 'escarpment' }),
    ],
  );

  it('is symmetric — argument order cannot change the result', () => {
    const forward = mergeLibraries(localSide, remoteSide).merged;
    const backward = mergeLibraries(remoteSide, localSide).merged;
    expect(stableStringify(forward)).toBe(stableStringify(backward));
  });

  it('is idempotent — re-merging a merged result changes nothing', () => {
    const once = mergeLibraries(localSide, remoteSide).merged;
    const twice = mergeLibraries(once, remoteSide);

    expect(stableStringify(twice.merged)).toBe(stableStringify(once));
    expect(twice.changedLocal).toBe(false);
  });

  it('converges — both devices reach the same state after syncing', () => {
    // Phone merges what it fetched; laptop merges what it fetched. They must agree.
    const phone = mergeLibraries(localSide, remoteSide).merged;
    const laptop = mergeLibraries(remoteSide, localSide).merged;

    expect(stableStringify(phone)).toBe(stableStringify(laptop));

    // And a second round settles rather than oscillating.
    expect(mergeLibraries(phone, laptop).changedLocal).toBe(false);
    expect(mergeLibraries(phone, laptop).changedRemote).toBe(false);
  });

  it('breaks timestamp ties deterministically, not by side', () => {
    const a = library([book()], [word({ note: 'aaa', updatedAt: '2026-01-01T00:00:00.000Z' })]);
    const b = library([book()], [word({ note: 'zzz', updatedAt: '2026-01-01T00:00:00.000Z' })]);

    const forward = mergeLibraries(a, b).merged.words[0].note;
    const backward = mergeLibraries(b, a).merged.words[0].note;

    // Preferring "local" on a tie would make the two devices disagree forever.
    expect(forward).toBe(backward);
  });
});

describe('schema version', () => {
  it('accepts a remote written by this build or an older one', () => {
    expect(isRemoteVersionSupported(SCHEMA_VERSION)).toBe(true);
    expect(isRemoteVersionSupported(SCHEMA_VERSION - 1)).toBe(true);
  });

  it('refuses a remote written by a newer app', () => {
    // Merging blind would silently drop fields this build knows nothing about.
    expect(isRemoteVersionSupported(SCHEMA_VERSION + 1)).toBe(false);
  });

  it('never writes back a version older than this build', () => {
    const result = mergeLibraries(library(), { version: 0, books: [], words: [] });
    expect(result.merged.version).toBe(SCHEMA_VERSION);
  });
});
