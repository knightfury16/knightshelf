import { describe, expect, it, vi } from 'vitest';
import {
  commitMessage,
  parseRemoteLibrary,
  runSync,
  serializeLibrary,
  type SyncIO,
} from './syncEngine';
import type { ReadOutcome, WriteOutcome } from '../api/github';
import { SCHEMA_VERSION, type Book, type LibraryData, type Word } from '../types';

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
    senses: [],
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

interface Harness {
  io: SyncIO;
  writeLocal: ReturnType<typeof vi.fn>;
  writeRemote: ReturnType<typeof vi.fn>;
  readLocal: ReturnType<typeof vi.fn>;
  /** Order of IO calls, for asserting sequencing. */
  calls: string[];
}

/**
 * `reads` and `writes` are consumed in order; the last entry repeats once exhausted,
 * which keeps the common single-attempt cases terse.
 */
function harness(options: {
  local: LibraryData | LibraryData[];
  reads: ReadOutcome[];
  writes?: WriteOutcome[];
}): Harness {
  const calls: string[] = [];
  const locals = Array.isArray(options.local) ? [...options.local] : [options.local];
  const reads = [...options.reads];
  const writes = [...(options.writes ?? [{ status: 'ok', sha: 'new-sha' }])];

  const next = <T>(queue: T[]): T => (queue.length > 1 ? (queue.shift() as T) : queue[0]);

  const readLocal = vi.fn(async () => {
    calls.push('readLocal');
    return next(locals);
  });
  const writeLocal = vi.fn(async () => {
    calls.push('writeLocal');
  });
  const readRemote = vi.fn(async () => {
    calls.push('readRemote');
    return next(reads);
  });
  const writeRemote = vi.fn(async () => {
    calls.push('writeRemote');
    return next(writes);
  });

  return {
    io: { readLocal, writeLocal, readRemote, writeRemote },
    readLocal,
    writeLocal,
    writeRemote,
    calls,
  };
}

const remoteFile = (data: LibraryData, sha = 'sha-1'): ReadOutcome => ({
  status: 'ok',
  text: serializeLibrary(data),
  sha,
});

describe('runSync — normal paths', () => {
  it('creates the file on the very first sync, with no sha', async () => {
    const h = harness({ local: library([book()], [word()]), reads: [{ status: 'empty' }] });
    const report = await runSync(h.io);

    expect(report).toMatchObject({ status: 'synced', pushed: true });
    expect(h.writeRemote).toHaveBeenCalledTimes(1);
    // A sha would tell GitHub to replace an existing file; there isn't one.
    expect(h.writeRemote.mock.calls[0][1]).toBeUndefined();
  });

  it('does nothing when both sides already match', async () => {
    const same = library([book()], [word()]);
    const h = harness({ local: same, reads: [remoteFile(same)] });
    const report = await runSync(h.io);

    expect(report).toMatchObject({ status: 'synced', pushed: false, pulled: false });
    expect(h.writeRemote).not.toHaveBeenCalled();
    expect(h.writeLocal).not.toHaveBeenCalled();
  });

  it('pulls without pushing when only the remote has moved on', async () => {
    const h = harness({
      local: library([book()], []),
      reads: [remoteFile(library([book()], [word()]))],
    });
    const report = await runSync(h.io);

    expect(report).toMatchObject({ status: 'synced', pulled: true, pushed: false });
    expect(h.writeLocal).toHaveBeenCalledTimes(1);
    expect(h.writeRemote).not.toHaveBeenCalled();
  });

  it('passes the sha through when replacing an existing file', async () => {
    const h = harness({
      local: library([book()], [word()]),
      reads: [remoteFile(library([book()], []), 'sha-abc')],
    });
    await runSync(h.io);

    expect(h.writeRemote.mock.calls[0][1]).toBe('sha-abc');
  });

  it('writes local before remote, so a failed push still leaves this device better off', async () => {
    const h = harness({
      local: library([book()], [word({ id: 'w-local' })]),
      reads: [remoteFile(library([book()], [word({ id: 'w-remote' })]))],
      writes: [{ status: 'offline' }],
    });
    const report = await runSync(h.io);

    expect(report).toMatchObject({ status: 'offline' });
    // The remote's word was still saved locally despite the push failing.
    expect(h.calls.indexOf('writeLocal')).toBeLessThan(h.calls.indexOf('writeRemote'));
    expect(h.writeLocal).toHaveBeenCalledTimes(1);
  });
});

describe('runSync — conflicts', () => {
  it('re-merges on top of the other device rather than overwriting it', async () => {
    const mine = word({ id: 'w-mine', term: 'gunwale' });
    const theirs = word({ id: 'w-theirs', term: 'escarpment' });

    const h = harness({
      local: library([book()], [mine]),
      reads: [
        // First read misses their word; the write then loses the race.
        remoteFile(library([book()], []), 'sha-old'),
        remoteFile(library([book()], [theirs]), 'sha-new'),
      ],
      writes: [{ status: 'conflict' }, { status: 'ok', sha: 'sha-final' }],
    });

    const report = await runSync(h.io);
    expect(report).toMatchObject({ status: 'synced', pushed: true });
    expect(h.writeRemote).toHaveBeenCalledTimes(2);

    // The decisive assertion: the retry carries BOTH words, and uses the fresh sha.
    const pushed = JSON.parse(h.writeRemote.mock.calls[1][0] as string) as LibraryData;
    expect(pushed.words.map((w) => w.term).sort()).toEqual(['escarpment', 'gunwale']);
    expect(h.writeRemote.mock.calls[1][1]).toBe('sha-new');
  });

  it('re-reads the remote before every retry', async () => {
    const h = harness({
      local: library([book()], [word()]),
      reads: [remoteFile(library(), 'a'), remoteFile(library(), 'b')],
      writes: [{ status: 'conflict' }, { status: 'ok', sha: 'c' }],
    });
    await runSync(h.io);

    // Retrying without re-reading would push against a stale sha forever.
    expect(h.calls).toEqual([
      'readLocal',
      'readRemote',
      'writeRemote',
      'readLocal',
      'readRemote',
      'writeRemote',
    ]);
  });

  it('picks up a word added locally during the retry', async () => {
    const first = library([book()], [word({ id: 'w1' })]);
    const second = library([book()], [word({ id: 'w1' }), word({ id: 'w2', term: 'added-later' })]);

    const h = harness({
      local: [first, second],
      reads: [remoteFile(library(), 'a'), remoteFile(library(), 'b')],
      writes: [{ status: 'conflict' }, { status: 'ok', sha: 'c' }],
    });
    await runSync(h.io);

    const pushed = JSON.parse(h.writeRemote.mock.calls[1][0] as string) as LibraryData;
    expect(pushed.words.map((w) => w.id).sort()).toEqual(['w1', 'w2']);
  });

  it('gives up after the attempt limit instead of forcing a write', async () => {
    const h = harness({
      local: library([book()], [word()]),
      reads: [remoteFile(library(), 'a')],
      writes: [{ status: 'conflict' }],
    });
    const report = await runSync(h.io, { maxAttempts: 3 });

    expect(report).toEqual({ status: 'conflict-unresolved', attempts: 3 });
    expect(h.writeRemote).toHaveBeenCalledTimes(3);
  });
});

describe('runSync — refusing to proceed', () => {
  it('never overwrites a remote file it cannot parse', async () => {
    const h = harness({
      local: library([book()], [word()]),
      reads: [{ status: 'ok', text: '{ this is not json', sha: 'x' }],
    });
    const report = await runSync(h.io);

    expect(report.status).toBe('remote-invalid');
    // Treating corruption as "empty" would destroy whatever was really there.
    expect(h.writeRemote).not.toHaveBeenCalled();
    expect(h.writeLocal).not.toHaveBeenCalled();
  });

  it('refuses a file that parses but is not a library', async () => {
    const h = harness({
      local: library(),
      reads: [{ status: 'ok', text: '{"hello":"world"}', sha: 'x' }],
    });
    expect((await runSync(h.io)).status).toBe('remote-invalid');
    expect(h.writeRemote).not.toHaveBeenCalled();
  });

  it('stops when the remote was written by a newer app', async () => {
    const h = harness({
      local: library(),
      reads: [
        {
          status: 'ok',
          text: JSON.stringify({ version: SCHEMA_VERSION + 1, books: [], words: [] }),
          sha: 'x',
        },
      ],
    });
    const report = await runSync(h.io);

    expect(report.status).toBe('app-outdated');
    // Pushing would strip fields this build knows nothing about.
    expect(h.writeRemote).not.toHaveBeenCalled();
  });

  it.each([
    ['unauthorized', 'unauthorized'],
    ['no-access', 'no-access'],
    ['offline', 'offline'],
    ['rate-limited', 'rate-limited'],
  ] as const)('surfaces a %s read without writing anything', async (status, expected) => {
    const h = harness({ local: library([book()], [word()]), reads: [{ status }] });
    const report = await runSync(h.io);

    expect(report.status).toBe(expected);
    expect(h.writeRemote).not.toHaveBeenCalled();
  });

  it('reports an oversized push with the numbers involved', async () => {
    const h = harness({
      local: library([book()], [word()]),
      reads: [{ status: 'empty' }],
      writes: [{ status: 'too-large', bytes: 1_200_000, limitBytes: 1_000_000 }],
    });
    const report = await runSync(h.io);

    expect(report).toEqual({ status: 'too-large', bytes: 1_200_000, limitBytes: 1_000_000 });
  });
});

describe('parseRemoteLibrary', () => {
  it('round-trips what serializeLibrary produces', () => {
    const data = library([book()], [word()]);
    const parsed = parseRemoteLibrary(serializeLibrary(data));

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.data).toEqual(data);
  });

  it('treats a blank file as an empty library', () => {
    const parsed = parseRemoteLibrary('   ');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.data.words).toEqual([]);
  });

  it('skips unusable rows and counts them rather than failing outright', () => {
    const parsed = parseRemoteLibrary(
      JSON.stringify({
        version: SCHEMA_VERSION,
        books: [book(), { title: 'no id' }],
        words: [word(), { id: 'w9' }],
      }),
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.skipped).toBe(2);
      expect(parsed.value.data.books).toHaveLength(1);
      expect(parsed.value.data.words).toHaveLength(1);
    }
  });

  it.each([
    ['not json at all', '{oops'],
    ['an array', '[]'],
    ['a missing version', '{"books":[],"words":[]}'],
    ['missing collections', '{"version":1}'],
  ])('rejects %s', (_label, text) => {
    expect(parseRemoteLibrary(text).ok).toBe(false);
  });
});

describe('serializeLibrary', () => {
  it('is human readable and newline terminated, so git diffs stay legible', () => {
    const text = serializeLibrary(library([book()], []));
    expect(text).toContain('\n  "version"');
    expect(text.endsWith('\n')).toBe(true);
  });
});

describe('commitMessage', () => {
  const base = {
    booksAdded: 0,
    booksUpdated: 0,
    wordsAdded: 0,
    wordsUpdated: 0,
    deletionsApplied: 0,
    orphanedWords: 0,
  };

  it('summarises what the sync carried', () => {
    expect(commitMessage({ ...base, wordsAdded: 3 })).toBe('Sync from Knightshelf (+3 words)');
    expect(commitMessage({ ...base, wordsAdded: 1 })).toBe('Sync from Knightshelf (+1 word)');
    expect(commitMessage({ ...base, wordsUpdated: 2 })).toBe('Sync from Knightshelf (2 updated)');
  });

  it('falls back to a plain message when there is nothing to summarise', () => {
    expect(commitMessage(base)).toBe('Sync from Knightshelf');
  });
});

describe('reading a version 1 file', () => {
  /** How a pre-trimming file stored a word: every sense, synonyms included. */
  const legacyWord = {
    id: 'w1',
    bookId: 'b1',
    term: 'sheet',
    senses: [
      { partOfSpeech: 'noun', definition: 'A thin bed cloth.', synonyms: ['bedsheet'] },
      { partOfSpeech: 'noun', definition: 'A rope controlling a sail.', synonyms: ['line'] },
    ],
    primarySense: 1,
    starred: false,
    lookupState: 'resolved',
    contextSentence: 'He hauled the sheet taut.',
    page: '114',
    addedAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const legacyFile = JSON.stringify({ version: 1, books: [book()], words: [legacyWord] });

  it('is still accepted, and trims each word to the sense the reader kept', () => {
    const parsed = parseRemoteLibrary(legacyFile);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const [word] = parsed.value.data.words;
    expect(word.senses).toHaveLength(1);
    expect(word.senses[0].definition).toBe('A rope controlling a sail.');
    expect(word.senses[0].synonyms).toBeUndefined();
    expect(word.primarySense).toBe(0);
  });

  it('preserves everything the reader supplied', () => {
    const parsed = parseRemoteLibrary(legacyFile);
    if (!parsed.ok) return;

    const [word] = parsed.value.data.words;
    expect(word.contextSentence).toBe('He hauled the sheet taut.');
    expect(word.page).toBe('114');
    expect(word.updatedAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('does not look like a change against an already-trimmed local record', async () => {
    /**
     * The regression this guards against: an untrimmed remote and a trimmed local
     * record differ only in shape, so the merge would treat it as a real edit and could
     * strip the device — worse on every sync. Normalising on read makes them equal.
     */
    const local = library([book()], [
      {
        ...legacyWord,
        senses: [{ partOfSpeech: 'noun', definition: 'A rope controlling a sail.' }],
        primarySense: 0,
      } as never,
    ]);

    const h = harness({ local, reads: [{ status: 'ok', text: legacyFile, sha: 'sha-1' }] });
    const report = await runSync(h.io);

    expect(report).toMatchObject({ status: 'synced', pulled: false });
    expect(h.writeLocal).not.toHaveBeenCalled();
  });

  it('rewrites the file at the current version once anything else changes', async () => {
    const h = harness({
      local: library([book()], [word({ id: 'w-new', term: 'gunwale' })]),
      reads: [{ status: 'ok', text: legacyFile, sha: 'sha-1' }],
    });
    await runSync(h.io);

    const pushed = JSON.parse(h.writeRemote.mock.calls[0][0] as string) as LibraryData;
    // Bumped, so an older app refuses the file rather than silently diverging.
    expect(pushed.version).toBe(SCHEMA_VERSION);
    expect(pushed.words.every((w) => w.senses.length <= 1)).toBe(true);
  });
});
