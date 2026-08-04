import { describe, expect, it } from 'vitest';
import { runShardedSync, type ShardedSyncIO } from './shardedSync';
import {
  LEGACY_PATH,
  MANIFEST_PATH,
  parseManifest,
  shardPath,
  splitIntoShards,
} from './shards';
import type { ReadOutcome, WriteOutcome } from '../api/github';
import { SCHEMA_VERSION, type Book, type LibraryData, type Word } from '../types';

/**
 * Driven against a virtual remote filesystem with real revisions, so conflicts, write
 * ordering and partial fetches behave as they would in practice rather than being
 * asserted on stubs.
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

interface Entry {
  text: string;
  sha: string;
}

interface HarnessOptions {
  local: LibraryData | LibraryData[];
  files?: Record<string, string>;
  known?: Record<string, string>;
  /** Paths that reject their first write, as if another device got there first. */
  conflictOnce?: string[];
  /** Runs when a conflict is simulated, to plant what the other device wrote. */
  onConflict?: (fs: Record<string, Entry>) => void;
}

function harness(options: HarnessOptions) {
  const fs: Record<string, Entry> = {};
  for (const [path, text] of Object.entries(options.files ?? {})) {
    fs[path] = { text, sha: `sha-${path}` };
  }

  const calls: string[] = [];
  const localWrites: LibraryData[] = [];
  const locals = Array.isArray(options.local) ? [...options.local] : [options.local];
  const conflictOnce = new Set(options.conflictOnce ?? []);
  let known = { ...(options.known ?? {}) };
  let shaCounter = 0;

  const io: ShardedSyncIO = {
    readLocal: async () => {
      calls.push('readLocal');
      return locals.length > 1 ? (locals.shift() as LibraryData) : locals[0];
    },
    writeLocal: async (data) => {
      calls.push('writeLocal');
      localWrites.push(data);
    },
    readFile: async (path): Promise<ReadOutcome> => {
      calls.push(`read:${path}`);
      const entry = fs[path];
      return entry ? { status: 'ok', text: entry.text, sha: entry.sha } : { status: 'empty' };
    },
    writeFile: async (path, text, sha): Promise<WriteOutcome> => {
      calls.push(`write:${path}`);

      if (conflictOnce.has(path)) {
        conflictOnce.delete(path);
        options.onConflict?.(fs);
        return { status: 'conflict' };
      }

      const current = fs[path];
      if (current && current.sha !== sha) return { status: 'conflict' };

      shaCounter += 1;
      fs[path] = { text, sha: `sha-new-${shaCounter}` };
      return { status: 'ok', sha: fs[path].sha };
    },
    readKnownRevisions: async () => ({ ...known }),
    writeKnownRevisions: async (revisions) => {
      known = { ...revisions };
    },
  };

  return { io, fs, calls, localWrites, getKnown: () => known };
}

/** A remote already in step with `data`, as if a previous sync had succeeded. */
function syncedState(data: LibraryData): { files: Record<string, string>; known: Record<string, string> } {
  const { manifest, shards } = splitIntoShards(data);
  const files: Record<string, string> = {
    [MANIFEST_PATH]: `${JSON.stringify(manifest, null, 2)}\n`,
  };
  for (const shard of shards) {
    files[shardPath(shard.bookId)] = `${JSON.stringify(shard, null, 2)}\n`;
  }
  return { files, known: manifest.shards };
}

const wordsIn = (fs: Record<string, Entry>, bookId: string): string[] => {
  const entry = fs[shardPath(bookId)];
  if (!entry) return [];
  return (JSON.parse(entry.text) as { words: Word[] }).words.map((w) => w.term).sort();
};

describe('first sync', () => {
  it('creates a shard per book and the manifest, with no revisions to quote', async () => {
    const h = harness({
      local: library(
        [book(), book({ id: 'b2', title: 'Moby Dick' })],
        [word({ id: 'w1' }), word({ id: 'w2', bookId: 'b2', term: 'ambergris' })],
      ),
    });

    const report = await runShardedSync(h.io);

    expect(report).toMatchObject({ status: 'synced', pushed: true, pulled: false });
    expect(Object.keys(h.fs).sort()).toEqual(
      [MANIFEST_PATH, shardPath('b1'), shardPath('b2')].sort(),
    );
    expect(wordsIn(h.fs, 'b1')).toEqual(['gunwale']);
    expect(wordsIn(h.fs, 'b2')).toEqual(['ambergris']);
  });

  it('keeps words out of the manifest, which is the entire point', async () => {
    const h = harness({ local: library([book()], [word()]) });
    await runShardedSync(h.io);

    const manifest = parseManifest(h.fs[MANIFEST_PATH].text);
    expect(manifest.ok).toBe(true);
    if (manifest.ok) {
      expect(manifest.value.books).toHaveLength(1);
      expect('words' in manifest.value).toBe(false);
    }
  });

  it('writes the manifest last, so it can never advertise a shard that is absent', async () => {
    const h = harness({ local: library([book()], [word()]) });
    await runShardedSync(h.io);

    const writes = h.calls.filter((call) => call.startsWith('write:'));
    expect(writes[writes.length - 1]).toBe(`write:${MANIFEST_PATH}`);
  });

  it('records the agreed revisions once everything has been written', async () => {
    const h = harness({ local: library([book()], [word()]) });
    await runShardedSync(h.io);

    const manifest = parseManifest(h.fs[MANIFEST_PATH].text);
    if (manifest.ok) expect(h.getKnown()).toEqual(manifest.value.shards);
  });
});

describe('a settled library', () => {
  const data = library(
    [book(), book({ id: 'b2', title: 'Moby Dick' })],
    [word({ id: 'w1' }), word({ id: 'w2', bookId: 'b2', term: 'ambergris' })],
  );

  it('writes nothing and fetches no shard when both sides agree', async () => {
    const h = harness({ local: data, ...syncedState(data) });
    const report = await runShardedSync(h.io);

    expect(report).toMatchObject({ status: 'synced', pushed: false, pulled: false });
    expect(h.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
    expect(h.calls.filter((c) => c.startsWith('read:'))).toEqual([`read:${MANIFEST_PATH}`]);
  });

  it('rewrites only the book that changed', async () => {
    const state = syncedState(data);
    const h = harness({
      local: library(data.books, [...data.words, word({ id: 'w3', term: 'escarpment' })]),
      ...state,
    });

    await runShardedSync(h.io);

    // The headline benefit: reading one book does not rewrite the archive.
    expect(h.calls).toContain(`write:${shardPath('b1')}`);
    expect(h.calls).not.toContain(`write:${shardPath('b2')}`);
    expect(h.calls).not.toContain(`read:${shardPath('b2')}`);
    expect(wordsIn(h.fs, 'b1')).toEqual(['escarpment', 'gunwale']);
  });
});

describe('pulling from another device', () => {
  it('adopts a book that exists only remotely', async () => {
    const remote = library([book({ id: 'b9', title: 'Ahab' })], [
      word({ id: 'w9', bookId: 'b9', term: 'leviathan' }),
    ]);

    const h = harness({ local: library(), ...syncedState(remote), known: {} });
    const report = await runShardedSync(h.io);

    expect(report).toMatchObject({ status: 'synced', pulled: true });
    expect(h.localWrites[0].words.map((w) => w.term)).toEqual(['leviathan']);
  });

  it('does not treat an unfetched book as deleted', async () => {
    const shared = library(
      [book(), book({ id: 'b2' })],
      [word({ id: 'w1' }), word({ id: 'w2', bookId: 'b2' })],
    );
    const state = syncedState(shared);

    const h = harness({
      local: library(shared.books, [...shared.words, word({ id: 'w3', term: 'crick' })]),
      ...state,
    });

    await runShardedSync(h.io);

    // b2 was never fetched, so its word must still be intact locally and remotely.
    const merged = h.localWrites[0] ?? null;
    if (merged) expect(merged.words.some((w) => w.id === 'w2')).toBe(true);
    expect(wordsIn(h.fs, 'b2')).toEqual(['gunwale']);
  });

  it('writes locally before writing anything remote', async () => {
    const remote = library([book()], [word({ id: 'w-remote', term: 'sagacity' })]);
    const h = harness({
      local: library([book()], [word({ id: 'w-local' })]),
      ...syncedState(remote),
      known: {},
    });

    await runShardedSync(h.io);

    const firstRemoteWrite = h.calls.findIndex((c) => c.startsWith('write:'));
    expect(h.calls.indexOf('writeLocal')).toBeLessThan(firstRemoteWrite);
  });
});

describe('conflicts', () => {
  it('re-merges on top of the other device rather than overwriting it', async () => {
    const base = library([book()], [word({ id: 'w-base', term: 'gunwale' })]);
    const state = syncedState(base);

    const h = harness({
      local: library([book()], [...base.words, word({ id: 'w-mine', term: 'brindle' })]),
      ...state,
      conflictOnce: [shardPath('b1')],
      onConflict: (fs) => {
        // The other device lands a word of its own while we were writing.
        const theirs = library([book()], [
          ...base.words,
          word({ id: 'w-theirs', term: 'portentous' }),
        ]);
        const next = syncedState(theirs);
        for (const [path, text] of Object.entries(next.files)) {
          fs[path] = { text, sha: `sha-${path}` };
        }
      },
    });

    const report = await runShardedSync(h.io);

    expect(report).toMatchObject({ status: 'synced' });
    // The decisive assertion: nobody's word was lost.
    expect(wordsIn(h.fs, 'b1')).toEqual(['brindle', 'gunwale', 'portentous']);
  });

  it('gives up after the attempt limit instead of forcing a write', async () => {
    const base = library([book()], [word()]);
    const h = harness({
      local: library([book()], [...base.words, word({ id: 'w2', term: 'crick' })]),
      ...syncedState(base),
      conflictOnce: [],
    });

    // Always conflict: hand back a sha the caller can never be holding.
    const io: ShardedSyncIO = {
      ...h.io,
      writeFile: async () => ({ status: 'conflict' }),
    };

    expect(await runShardedSync(io, { maxAttempts: 3 })).toEqual({
      status: 'conflict-unresolved',
      attempts: 3,
    });
  });

  it('does not record revisions when a write never succeeded', async () => {
    const h = harness({ local: library([book()], [word()]) });
    const io: ShardedSyncIO = { ...h.io, writeFile: async () => ({ status: 'conflict' }) };

    await runShardedSync(io, { maxAttempts: 1 });
    // Recording them would make the next sync skip a book it never actually pushed.
    expect(h.getKnown()).toEqual({});
  });
});

describe('migrating from the single-file layout', () => {
  const legacy = {
    version: 2,
    books: [book(), book({ id: 'b2', title: 'Moby Dick' })],
    words: [word({ id: 'w1' }), word({ id: 'w2', bookId: 'b2', term: 'ambergris' })],
  };

  it('folds the old file in and writes the new layout', async () => {
    const h = harness({
      local: library(),
      files: { [LEGACY_PATH]: JSON.stringify(legacy, null, 2) },
    });

    const report = await runShardedSync(h.io);

    expect(report).toMatchObject({ status: 'synced' });
    expect(wordsIn(h.fs, 'b1')).toEqual(['gunwale']);
    expect(wordsIn(h.fs, 'b2')).toEqual(['ambergris']);
    expect(h.localWrites[0].words).toHaveLength(2);
  });

  it('leaves a version marker behind so an older app refuses to diverge', async () => {
    const h = harness({
      local: library(),
      files: { [LEGACY_PATH]: JSON.stringify(legacy, null, 2) },
    });

    await runShardedSync(h.io);

    const retired = JSON.parse(h.fs[LEGACY_PATH].text) as LibraryData;
    expect(retired.version).toBe(SCHEMA_VERSION);
    expect(retired.words).toEqual([]);
    expect(retired.books).toEqual([]);
  });

  it('does nothing special when there is no old file either', async () => {
    const h = harness({ local: library([book()], [word()]) });
    await runShardedSync(h.io);

    expect(h.calls).toContain(`read:${LEGACY_PATH}`);
    // Nothing to retire, so no marker is written.
    expect(h.fs[LEGACY_PATH]).toBeUndefined();
  });
});

describe('refusing to proceed', () => {
  it('never overwrites a manifest it cannot parse', async () => {
    const h = harness({
      local: library([book()], [word()]),
      files: { [MANIFEST_PATH]: '{ not json' },
    });

    const report = await runShardedSync(h.io);

    expect(report.status).toBe('remote-invalid');
    expect(h.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
  });

  it('never overwrites a shard it cannot parse', async () => {
    const data = library([book()], [word()]);
    const state = syncedState(data);
    state.files[shardPath('b1')] = '{ broken';

    const h = harness({
      local: library([book()], [word({ id: 'w2', term: 'crick' })]),
      ...state,
      known: {},
    });

    const report = await runShardedSync(h.io);

    expect(report.status).toBe('remote-invalid');
    expect(h.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
  });

  it('stops when the manifest came from a newer app', async () => {
    const h = harness({
      local: library([book()], [word()]),
      files: {
        [MANIFEST_PATH]: JSON.stringify({ version: SCHEMA_VERSION + 1, books: [], shards: {} }),
      },
    });

    const report = await runShardedSync(h.io);

    expect(report.status).toBe('app-outdated');
    expect(h.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
  });

  it.each([
    ['unauthorized', 'unauthorized'],
    ['no-access', 'no-access'],
    ['offline', 'offline'],
    ['rate-limited', 'rate-limited'],
  ] as const)('surfaces a %s manifest read without writing', async (status, expected) => {
    const h = harness({ local: library([book()], [word()]) });
    const io: ShardedSyncIO = { ...h.io, readFile: async () => ({ status }) };

    expect((await runShardedSync(io)).status).toBe(expected);
    expect(h.calls.filter((c) => c.startsWith('write:'))).toEqual([]);
  });
});
