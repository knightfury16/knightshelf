import { describe, expect, it } from 'vitest';
import {
  MANIFEST_PATH,
  assembleLibrary,
  groupWordsByBook,
  parseManifest,
  parseShard,
  planShardsToSync,
  shardPath,
  shardRevision,
  splitIntoShards,
} from './shards';
import { SCHEMA_VERSION, type Book, type LibraryData, type Word } from '../types';

/**
 * Sharding multiplies the places where two devices can disagree, and every one of those
 * is somewhere data can go missing. These tests pin down the properties the engine
 * relies on: revisions agree across devices, splitting loses nothing, and planning never
 * skips a book that either side has touched.
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

describe('shardPath', () => {
  it('puts each book in its own file', () => {
    expect(shardPath('b1')).toBe('books/b1.json');
  });

  it('encodes an id that would otherwise alter the path', () => {
    expect(shardPath('a/b')).toBe('books/a%2Fb.json');
    expect(shardPath('a b')).toBe('books/a%20b.json');
  });

  it('never collides with the manifest', () => {
    expect(shardPath('manifest')).not.toBe(MANIFEST_PATH);
  });
});

describe('shardRevision', () => {
  it('ignores the order the words happen to be in', () => {
    const a = [word({ id: 'w1' }), word({ id: 'w2' })];
    const b = [word({ id: 'w2' }), word({ id: 'w1' })];
    // Two devices holding the same set must agree, however they stored it.
    expect(shardRevision(a)).toBe(shardRevision(b));
  });

  it('changes when a word is added, edited or removed', () => {
    const base = [word()];
    expect(shardRevision([...base, word({ id: 'w2' })])).not.toBe(shardRevision(base));
    expect(shardRevision([word({ note: 'edited' })])).not.toBe(shardRevision(base));
    expect(shardRevision([])).not.toBe(shardRevision(base));
  });

  it('distinguishes different sets that share their newest timestamp', () => {
    // Why a revision is a content hash rather than a max updatedAt: these would collide.
    const left = [word({ id: 'w1' }), word({ id: 'w2' })];
    const right = [word({ id: 'w1' }), word({ id: 'w3' })];
    expect(shardRevision(left)).not.toBe(shardRevision(right));
  });

  it('is stable for an empty book', () => {
    expect(shardRevision([])).toBe(shardRevision([]));
  });
});

describe('splitIntoShards', () => {
  it('gives every book its own shard and records a revision for it', () => {
    const data = library(
      [book(), book({ id: 'b2', title: 'Moby Dick' })],
      [word({ id: 'w1', bookId: 'b1' }), word({ id: 'w2', bookId: 'b2' })],
    );
    const { manifest, shards } = splitIntoShards(data);

    expect(shards.map((shard) => shard.bookId)).toEqual(['b1', 'b2']);
    expect(Object.keys(manifest.shards).sort()).toEqual(['b1', 'b2']);
    expect(manifest.version).toBe(SCHEMA_VERSION);
  });

  it('keeps the manifest free of words, which is the entire point', () => {
    const { manifest } = splitIntoShards(library([book()], [word()]));
    expect('words' in manifest).toBe(false);
  });

  it('still writes a shard for a book with no words', () => {
    // Without this, a newly added book would have no file and could look unreal.
    const { shards } = splitIntoShards(library([book({ id: 'empty' })], []));
    expect(shards).toHaveLength(1);
    expect(shards[0].words).toEqual([]);
  });

  it('preserves a word whose book is missing rather than dropping it', () => {
    const { shards } = splitIntoShards(library([], [word({ bookId: 'ghost' })]));
    expect(shards.map((shard) => shard.bookId)).toEqual(['ghost']);
    expect(shards[0].words).toHaveLength(1);
  });

  it('sorts books and words by id, so diffs stay small', () => {
    const { manifest, shards } = splitIntoShards(
      library(
        [book({ id: 'b2' }), book({ id: 'b1' })],
        [word({ id: 'w2' }), word({ id: 'w1' })],
      ),
    );
    expect(manifest.books.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(shards[0].words.map((w) => w.id)).toEqual(['w1', 'w2']);
  });

  it('agrees with the revisions it advertises', () => {
    const { manifest, shards } = splitIntoShards(library([book()], [word()]));
    for (const shard of shards) {
      expect(manifest.shards[shard.bookId]).toBe(shardRevision(shard.words));
    }
  });
});

describe('assembleLibrary', () => {
  it('rebuilds exactly what was split apart', () => {
    const original = library(
      [book(), book({ id: 'b2' })],
      [word({ id: 'w1' }), word({ id: 'w2', bookId: 'b2' })],
    );
    const { manifest, shards } = splitIntoShards(original);
    const rebuilt = assembleLibrary(manifest, shards);

    expect(rebuilt.books).toHaveLength(2);
    expect(rebuilt.words.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
  });

  it('yields only the books when no shard was fetched', () => {
    const { manifest } = splitIntoShards(library([book()], [word()]));
    // A partial fetch must not invent words it hasn't seen.
    expect(assembleLibrary(manifest, []).words).toEqual([]);
  });
});

describe('parseManifest', () => {
  it('round-trips what splitIntoShards produces', () => {
    const { manifest } = splitIntoShards(library([book()], [word()]));
    const parsed = parseManifest(JSON.stringify(manifest));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toEqual(manifest);
  });

  it('treats a blank file as an empty manifest', () => {
    const parsed = parseManifest('  ');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.books).toEqual([]);
  });

  it.each([
    ['not JSON', '{oops'],
    ['an array', '[]'],
    ['a missing version', '{"books":[]}'],
    ['a missing book list', '{"version":3}'],
  ])('refuses %s rather than treating it as empty', (_label, text) => {
    // Treating a broken manifest as empty would push our copy over real data.
    expect(parseManifest(text).ok).toBe(false);
  });

  it('drops revision entries that are not strings', () => {
    const parsed = parseManifest('{"version":3,"books":[],"shards":{"b1":"ok","b2":7}}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.shards).toEqual({ b1: 'ok' });
  });

  it('tolerates a manifest with no shard map at all', () => {
    const parsed = parseManifest('{"version":3,"books":[]}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.shards).toEqual({});
  });

  it('skips book rows that could not take part in a merge', () => {
    const parsed = parseManifest('{"version":3,"books":[{"id":"b1","updatedAt":"x"},{"nope":1}]}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.books).toHaveLength(1);
  });
});

describe('parseShard', () => {
  it('round-trips a shard', () => {
    const { shards } = splitIntoShards(library([book()], [word()]));
    const parsed = parseShard(JSON.stringify(shards[0]), 'b1');

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.words).toHaveLength(1);
  });

  it('treats a blank file as an empty shard for the book asked for', () => {
    const parsed = parseShard('', 'b9');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value).toMatchObject({ bookId: 'b9', words: [] });
  });

  it('trusts the path over a mismatched id inside the file', () => {
    const parsed = parseShard('{"version":3,"bookId":"wrong","words":[]}', 'b1');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.bookId).toBe('wrong');
  });

  it('trims words on the way in, so shapes match across devices', () => {
    const legacy = JSON.stringify({
      version: 2,
      bookId: 'b1',
      words: [
        {
          ...word(),
          senses: [
            { partOfSpeech: 'noun', definition: 'first', synonyms: ['a'] },
            { partOfSpeech: 'noun', definition: 'second' },
          ],
          primarySense: 1,
        },
      ],
    });

    const parsed = parseShard(legacy, 'b1');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.words[0].senses).toHaveLength(1);
    expect(parsed.value.words[0].senses[0].definition).toBe('second');
    expect(parsed.value.words[0].senses[0].synonyms).toBeUndefined();
  });

  it.each([
    ['not JSON', '{oops'],
    ['a missing word list', '{"version":3,"bookId":"b1"}'],
  ])('refuses %s', (_label, text) => {
    expect(parseShard(text, 'b1').ok).toBe(false);
  });
});

describe('planShardsToSync', () => {
  const rev = (words: Word[]) => shardRevision(words);

  it('fetches nothing when both sides match what we last agreed', () => {
    const words = [word()];
    const plan = planShardsToSync({
      localWordsByBook: groupWordsByBook(words),
      localBookIds: ['b1'],
      remoteRevisions: { b1: rev(words) },
      knownRevisions: { b1: rev(words) },
    });
    expect(plan).toEqual([]);
  });

  it('fetches a book we have never synced', () => {
    const plan = planShardsToSync({
      localWordsByBook: groupWordsByBook([word()]),
      localBookIds: ['b1'],
      remoteRevisions: {},
      knownRevisions: {},
    });
    expect(plan).toEqual(['b1']);
  });

  it('fetches a book changed locally, so a push can never clobber', () => {
    const known = rev([word()]);
    const plan = planShardsToSync({
      localWordsByBook: groupWordsByBook([word(), word({ id: 'w2' })]),
      localBookIds: ['b1'],
      remoteRevisions: { b1: known },
      knownRevisions: { b1: known },
    });
    expect(plan).toEqual(['b1']);
  });

  it('fetches a book changed remotely', () => {
    const words = [word()];
    const plan = planShardsToSync({
      localWordsByBook: groupWordsByBook(words),
      localBookIds: ['b1'],
      remoteRevisions: { b1: 'moved-on' },
      knownRevisions: { b1: rev(words) },
    });
    expect(plan).toEqual(['b1']);
  });

  it('fetches a book that exists only on the other device', () => {
    const plan = planShardsToSync({
      localWordsByBook: new Map(),
      localBookIds: [],
      remoteRevisions: { b9: 'abc' },
      knownRevisions: {},
    });
    expect(plan).toEqual(['b9']);
  });

  it('leaves untouched books alone while syncing the one being read', () => {
    const quiet = [word({ id: 'q1', bookId: 'quiet' })];
    const active = [word({ id: 'a1', bookId: 'active' })];

    const plan = planShardsToSync({
      localWordsByBook: groupWordsByBook([
        ...quiet,
        ...active,
        word({ id: 'a2', bookId: 'active' }),
      ]),
      localBookIds: ['quiet', 'active'],
      remoteRevisions: { quiet: rev(quiet), active: rev(active) },
      knownRevisions: { quiet: rev(quiet), active: rev(active) },
    });

    // The whole point: reading one book must not rewrite the archive.
    expect(plan).toEqual(['active']);
  });

  it('notices a book emptied locally', () => {
    const known = rev([word()]);
    const plan = planShardsToSync({
      localWordsByBook: new Map(),
      localBookIds: ['b1'],
      remoteRevisions: { b1: known },
      knownRevisions: { b1: known },
    });
    expect(plan).toEqual(['b1']);
  });

  it('returns a stable, sorted plan', () => {
    const plan = planShardsToSync({
      localWordsByBook: new Map(),
      localBookIds: [],
      remoteRevisions: { z: 'a', a: 'b', m: 'c' },
      knownRevisions: {},
    });
    expect(plan).toEqual(['a', 'm', 'z']);
  });
});
