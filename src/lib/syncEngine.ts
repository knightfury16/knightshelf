import type { LibraryData } from '../types';
import { emptyLibrary } from '../types';
import type { ReadOutcome, WriteOutcome } from '../api/github';
import { isRemoteVersionSupported, mergeLibraries, type MergeStats } from './merge';

/**
 * Pull, merge, push — with the network injected.
 *
 * The IO is a parameter rather than an import so the retry-on-conflict path can be
 * driven by fakes in tests. That path is the one place where a mistake silently
 * destroys the other device's words, so it needs to be exercised directly rather than
 * hoped about.
 *
 * The cardinal rule: **never force a write.** A conflict means the other device wrote
 * first, so we re-read, re-merge on top of what they wrote, and try again. Overwriting
 * with our own copy would discard whatever they had just added.
 */

export interface SyncIO {
  /** Full local snapshot, tombstones included. */
  readLocal: () => Promise<LibraryData>;
  writeLocal: (data: LibraryData) => Promise<void>;
  readRemote: () => Promise<ReadOutcome>;
  writeRemote: (text: string, sha: string | undefined, message: string) => Promise<WriteOutcome>;
}

export type SyncReport =
  | { status: 'synced'; stats: MergeStats; pulled: boolean; pushed: boolean }
  | { status: 'unauthorized' }
  | { status: 'no-access' }
  | { status: 'offline' }
  | { status: 'rate-limited' }
  | { status: 'too-large'; bytes?: number; limitBytes: number }
  /** Remote was written by a newer build; merging would drop fields we don't know. */
  | { status: 'app-outdated' }
  /** Remote file is not readable as a library; refuse rather than overwrite it. */
  | { status: 'remote-invalid'; message: string }
  | { status: 'conflict-unresolved'; attempts: number }
  | { status: 'error'; message: string };

/**
 * Pretty-printed, key-stable, newline-terminated.
 *
 * Formatting costs roughly a third more bytes, bought deliberately: the file lives in
 * git, so a readable diff turns each sync commit into a legible record of what was
 * learned that day. Records are already id-sorted by the merge, which keeps diffs
 * minimal instead of reshuffling the whole file on every push.
 */
export function serializeLibrary(data: LibraryData): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A record without an id or timestamp cannot take part in a merge. */
function usableRecords<T>(list: unknown[]): T[] {
  return list.filter(
    (item): item is T =>
      isRecord(item) && typeof item.id === 'string' && typeof item.updatedAt === 'string',
  );
}

export interface ParsedRemote {
  data: LibraryData;
  /** Entries dropped for being unusable, reported rather than hidden. */
  skipped: number;
}

export type ParseResult =
  | { ok: true; value: ParsedRemote }
  | { ok: false; message: string };

/**
 * Strict on the envelope, lenient on individual records.
 *
 * A malformed file must never be treated as empty: that would push our copy over the
 * top and destroy whatever was actually there. So the envelope failing is a hard stop,
 * while a single unusable row is skipped and counted.
 */
export function parseRemoteLibrary(text: string): ParseResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: { data: emptyLibrary(), skipped: 0 } };

  let payload: unknown;
  try {
    payload = JSON.parse(trimmed);
  } catch {
    return { ok: false, message: 'The synced file is not valid JSON.' };
  }

  if (!isRecord(payload)) {
    return { ok: false, message: 'The synced file is not a library.' };
  }

  const { version, books, words } = payload;
  if (typeof version !== 'number' || !Array.isArray(books) || !Array.isArray(words)) {
    return { ok: false, message: 'The synced file is missing its version, books or words.' };
  }

  const keptBooks = usableRecords<LibraryData['books'][number]>(books);
  const keptWords = usableRecords<LibraryData['words'][number]>(words);

  return {
    ok: true,
    value: {
      data: { version, books: keptBooks, words: keptWords },
      skipped: books.length - keptBooks.length + (words.length - keptWords.length),
    },
  };
}

export function commitMessage(stats: MergeStats): string {
  const parts: string[] = [];
  if (stats.wordsAdded) parts.push(`+${stats.wordsAdded} word${stats.wordsAdded === 1 ? '' : 's'}`);
  if (stats.booksAdded) parts.push(`+${stats.booksAdded} book${stats.booksAdded === 1 ? '' : 's'}`);
  if (stats.wordsUpdated || stats.booksUpdated) {
    parts.push(`${stats.wordsUpdated + stats.booksUpdated} updated`);
  }
  return parts.length > 0 ? `Sync from Knightshelf (${parts.join(', ')})` : 'Sync from Knightshelf';
}

/** Maps a failed read to the matching report; returns null when the read succeeded. */
function reportForRead(outcome: ReadOutcome): SyncReport | null {
  switch (outcome.status) {
    case 'ok':
    case 'empty':
      return null;
    case 'too-large':
      return { status: 'too-large', limitBytes: outcome.limitBytes };
    case 'error':
      return { status: 'error', message: outcome.message };
    default:
      return { status: outcome.status };
  }
}

const DEFAULT_MAX_ATTEMPTS = 3;

export async function runSync(
  io: SyncIO,
  options: { maxAttempts?: number } = {},
): Promise<SyncReport> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Re-read local each attempt: the user may have added a word while we retried.
    const local = await io.readLocal();
    const read = await io.readRemote();

    const readFailure = reportForRead(read);
    if (readFailure) return readFailure;

    let remote: LibraryData = emptyLibrary();
    let sha: string | undefined;

    if (read.status === 'ok') {
      const parsed = parseRemoteLibrary(read.text);
      if (!parsed.ok) return { status: 'remote-invalid', message: parsed.message };
      remote = parsed.value.data;
      sha = read.sha;
    }

    if (!isRemoteVersionSupported(remote.version)) return { status: 'app-outdated' };

    const outcome = mergeLibraries(local, remote);

    // Apply what the other device knew before pushing, so a failed push still leaves
    // this device better off than it started.
    if (outcome.changedLocal) await io.writeLocal(outcome.merged);

    if (!outcome.changedRemote) {
      return { status: 'synced', stats: outcome.stats, pulled: outcome.changedLocal, pushed: false };
    }

    const write = await io.writeRemote(
      serializeLibrary(outcome.merged),
      sha,
      commitMessage(outcome.stats),
    );

    if (write.status === 'ok') {
      return { status: 'synced', stats: outcome.stats, pulled: outcome.changedLocal, pushed: true };
    }

    // Someone wrote between our read and our write. Start over on top of their copy.
    if (write.status === 'conflict') continue;

    if (write.status === 'too-large') {
      return { status: 'too-large', bytes: write.bytes, limitBytes: write.limitBytes };
    }
    if (write.status === 'error') return { status: 'error', message: write.message };
    return { status: write.status };
  }

  return { status: 'conflict-unresolved', attempts: maxAttempts };
}
