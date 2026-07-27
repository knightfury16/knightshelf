import type { Book, LibraryData, Word } from '../types';
import { SCHEMA_VERSION } from '../types';

/**
 * Merging two copies of the library.
 *
 * The whole data model exists to make this operation safe: records are append-mostly,
 * carry `updatedAt`, and are deleted by tombstone rather than removal. So merging is a
 * union by id with newest-wins on collisions — there is no genuine conflict to ask the
 * user to resolve, and nothing is ever dropped because one side hadn't seen it yet.
 *
 * Two properties matter more than anything else here, and both are tested:
 *
 * - **Symmetry.** `merge(a, b)` and `merge(b, a)` must agree. Otherwise two devices
 *   each prefer their own copy and ping-pong forever without converging.
 * - **Idempotence.** Merging an already-merged result changes nothing, so a repeated
 *   or retried sync is harmless.
 */

interface Record_ {
  id: string;
  updatedAt: string;
  deletedAt?: string;
}

/**
 * Key order independent serialisation.
 *
 * `JSON.stringify` follows insertion order, which differs between an object this app
 * constructed and the same object parsed back from GitHub. Comparing those directly
 * would report spurious changes and cause an endless push loop.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  const entries = Object.entries(value as globalThis.Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/**
 * Picks the surviving version of a record present on both sides.
 *
 * Equal timestamps are broken by comparing the serialised records, not by preferring
 * "local" — a side-relative rule would make the merge asymmetric and stop the two
 * devices ever agreeing.
 */
function pickWinner<T extends Record_>(a: T, b: T): T {
  if (a.updatedAt > b.updatedAt) return a;
  if (b.updatedAt > a.updatedAt) return b;
  return stableStringify(a) <= stableStringify(b) ? a : b;
}

interface RecordMerge<T> {
  merged: T[];
  added: number;
  updated: number;
  deletionsApplied: number;
}

function mergeRecords<T extends Record_>(local: T[], remote: T[]): RecordMerge<T> {
  const byId = new Map<string, T>(local.map((record) => [record.id, record]));

  let added = 0;
  let updated = 0;
  let deletionsApplied = 0;

  for (const incoming of remote) {
    const existing = byId.get(incoming.id);

    if (!existing) {
      byId.set(incoming.id, incoming);
      added += 1;
      continue;
    }

    const winner = pickWinner(existing, incoming);
    if (winner === existing) continue;

    byId.set(incoming.id, winner);
    updated += 1;
    // A tombstone arriving for something this device still considered live.
    if (winner.deletedAt && !existing.deletedAt) deletionsApplied += 1;
  }

  const merged = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { merged, added, updated, deletionsApplied };
}

export interface MergeStats {
  booksAdded: number;
  booksUpdated: number;
  wordsAdded: number;
  wordsUpdated: number;
  /** Tombstones that arrived for records this device still had live. */
  deletionsApplied: number;
  /**
   * Live words whose book is deleted or absent after merging.
   *
   * Happens when one device deletes a book while another adds a word to it. Such words
   * are invisible in the UI but are deliberately **not** deleted here — silently
   * discarding data during a merge is the worst possible outcome, so they are counted
   * and reported instead.
   */
  orphanedWords: number;
}

export interface MergeOutcome {
  merged: LibraryData;
  stats: MergeStats;
  /** The merged result differs from what this device held; write it locally. */
  changedLocal: boolean;
  /** The merged result differs from the remote copy; push it. */
  changedRemote: boolean;
}

/**
 * A newer app on another device may have written a format this build cannot read.
 * Merging blindly would silently discard fields it doesn't know about, so the caller
 * must refuse and tell the user to update.
 */
export function isRemoteVersionSupported(remoteVersion: number): boolean {
  return remoteVersion <= SCHEMA_VERSION;
}

function sameRecords<T extends Record_>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const sortById = (list: T[]) =>
    [...list].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  return stableStringify(sortById(a)) === stableStringify(sortById(b));
}

function countOrphans(books: Book[], words: Word[]): number {
  const liveBooks = new Set(books.filter((book) => !book.deletedAt).map((book) => book.id));
  return words.filter((word) => !word.deletedAt && !liveBooks.has(word.bookId)).length;
}

/**
 * Assumes the remote version has already been accepted by `isRemoteVersionSupported`.
 */
export function mergeLibraries(local: LibraryData, remote: LibraryData): MergeOutcome {
  const books = mergeRecords(local.books, remote.books);
  const words = mergeRecords(local.words, remote.words);

  const merged: LibraryData = {
    // Never write back a version older than this build understands.
    version: Math.max(local.version, remote.version, SCHEMA_VERSION),
    books: books.merged,
    words: words.merged,
  };

  return {
    merged,
    stats: {
      booksAdded: books.added,
      booksUpdated: books.updated,
      wordsAdded: words.added,
      wordsUpdated: words.updated,
      deletionsApplied: books.deletionsApplied + words.deletionsApplied,
      orphanedWords: countOrphans(merged.books, merged.words),
    },
    changedLocal:
      !sameRecords(merged.books, local.books) ||
      !sameRecords(merged.words, local.words) ||
      merged.version !== local.version,
    changedRemote:
      !sameRecords(merged.books, remote.books) ||
      !sameRecords(merged.words, remote.words) ||
      merged.version !== remote.version,
  };
}
