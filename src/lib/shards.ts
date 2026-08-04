import type { Book, LibraryData, Word } from '../types';
import { SCHEMA_VERSION } from '../types';
import { hashString } from './hash';
import { stableStringify } from './merge';
import { trimWords } from './senses';

/**
 * Splitting the library across files, one per book.
 *
 * A single file has a hard ceiling: the Contents API caps a file near 1 MB, so one
 * library eventually stops syncing. Per-book files have no such limit, because no book
 * produces enough lookups to approach it — and a sync then rewrites only the book being
 * read rather than the whole archive.
 *
 * Two rules keep this safe, and both are load-bearing:
 *
 * 1. **Shards are written before the manifest.** The manifest may then lag behind
 *    reality, which costs a missed fetch that heals on the writer's next sync. Writing
 *    the manifest first would instead have it advertise revisions that do not exist.
 * 2. **Revisions are hints, never authority.** A stale revision can cause a redundant
 *    fetch or a brief delay in another device seeing a word. It can never cause a record
 *    to be dropped, because merging remains by id and timestamp over whatever the shard
 *    actually contains.
 */

export const MANIFEST_PATH = 'manifest.json';

/** The pre-sharding single file, kept as a tripwire so older apps refuse to drift. */
export const LEGACY_PATH = 'library.json';

export function shardPath(bookId: string): string {
  return `books/${encodeURIComponent(bookId)}.json`;
}

export interface Manifest {
  version: number;
  books: Book[];
  /** bookId → revision of that book's shard. Advisory only. */
  shards: Record<string, string>;
}

export interface Shard {
  version: number;
  bookId: string;
  words: Word[];
}

/**
 * Content revision for a book's words.
 *
 * Derived from the words themselves so two devices holding the same set always agree —
 * a timestamp would let differing sets collide when their newest edit happened to
 * match. Records are id-sorted first so ordering can't affect the result.
 */
export function shardRevision(words: Word[]): string {
  const ordered = [...words].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return hashString(stableStringify(ordered)).toString(36);
}

export function groupWordsByBook(words: Word[]): Map<string, Word[]> {
  const grouped = new Map<string, Word[]>();
  for (const word of words) {
    const existing = grouped.get(word.bookId);
    if (existing) existing.push(word);
    else grouped.set(word.bookId, [word]);
  }
  return grouped;
}

export interface SplitLibrary {
  manifest: Manifest;
  shards: Shard[];
}

/**
 * Every book gets a shard, including one with no words — otherwise a book added on one
 * device would have no file and could look like it had never existed.
 *
 * Words whose book is absent from the library still get a shard of their own, so an
 * orphan is preserved rather than silently dropped.
 */
export function splitIntoShards(data: LibraryData): SplitLibrary {
  const grouped = groupWordsByBook(data.words);

  const bookIds = new Set<string>([...data.books.map((book) => book.id), ...grouped.keys()]);

  const shards: Shard[] = [...bookIds]
    .sort()
    .map((bookId) => ({
      version: SCHEMA_VERSION,
      bookId,
      words: (grouped.get(bookId) ?? []).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    }));

  const revisions: Record<string, string> = {};
  for (const shard of shards) revisions[shard.bookId] = shardRevision(shard.words);

  return {
    manifest: {
      version: SCHEMA_VERSION,
      books: [...data.books].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
      shards: revisions,
    },
    shards,
  };
}

/** Rebuilds one library from a manifest and whichever shards were fetched. */
export function assembleLibrary(manifest: Manifest, shards: Shard[]): LibraryData {
  return {
    version: manifest.version,
    books: manifest.books,
    words: shards.flatMap((shard) => shard.words),
  };
}

/* --------------------------------------------------------------- parsing */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function usableRecords<T>(list: unknown[]): T[] {
  return list.filter(
    (item): item is T =>
      isRecord(item) && typeof item.id === 'string' && typeof item.updatedAt === 'string',
  );
}

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * Strict on the envelope, lenient on individual rows.
 *
 * A file that cannot be understood must never be treated as empty: that would push our
 * copy over the top of real data. So a malformed envelope is a hard stop.
 */
export function parseManifest(text: string): ParseOutcome<Manifest> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: { version: SCHEMA_VERSION, books: [], shards: {} } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: 'The manifest is not valid JSON.' };
  }

  if (!isRecord(payload)) return { ok: false, message: 'The manifest is not an object.' };
  if (typeof payload.version !== 'number' || !Array.isArray(payload.books)) {
    return { ok: false, message: 'The manifest is missing its version or book list.' };
  }

  const shards: Record<string, string> = {};
  if (isRecord(payload.shards)) {
    for (const [bookId, revision] of Object.entries(payload.shards)) {
      if (typeof revision === 'string') shards[bookId] = revision;
    }
  }

  return {
    ok: true,
    value: { version: payload.version, books: usableRecords<Book>(payload.books), shards },
  };
}

export function parseShard(text: string, expectedBookId: string): ParseOutcome<Shard> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: true, value: { version: SCHEMA_VERSION, bookId: expectedBookId, words: [] } };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: `The file for one book is not valid JSON.` };
  }

  if (!isRecord(payload) || !Array.isArray(payload.words)) {
    return { ok: false, message: 'A book file is missing its word list.' };
  }

  const version = typeof payload.version === 'number' ? payload.version : SCHEMA_VERSION;

  return {
    ok: true,
    value: {
      version,
      // Trust the path we asked for over a mismatched field inside the file.
      bookId: typeof payload.bookId === 'string' ? payload.bookId : expectedBookId,
      words: trimWords(usableRecords<Word>(payload.words)),
    },
  };
}

/* -------------------------------------------------------------- planning */

/**
 * Which books need fetching before anything is written.
 *
 * A book is included when either side has moved since the last agreed revision. Both
 * directions matter: a remote change must be pulled, and a local change must be merged
 * against the remote *before* being written, so a push can never clobber.
 */
export function planShardsToSync(input: {
  localWordsByBook: Map<string, Word[]>;
  localBookIds: Iterable<string>;
  remoteRevisions: Record<string, string>;
  knownRevisions: Record<string, string>;
}): string[] {
  const candidates = new Set<string>([
    ...input.localWordsByBook.keys(),
    ...input.localBookIds,
    ...Object.keys(input.remoteRevisions),
  ]);

  const needed: string[] = [];

  for (const bookId of candidates) {
    const known = input.knownRevisions[bookId];
    const local = shardRevision(input.localWordsByBook.get(bookId) ?? []);
    const remote = input.remoteRevisions[bookId];

    // Never seen it before, so there is nothing to compare against.
    if (known === undefined) {
      needed.push(bookId);
      continue;
    }

    if (local !== known || (remote !== undefined && remote !== known)) needed.push(bookId);
  }

  return needed.sort();
}
