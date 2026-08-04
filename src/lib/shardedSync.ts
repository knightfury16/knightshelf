import type { LibraryData } from '../types';
import { SCHEMA_VERSION, emptyLibrary } from '../types';
import type { ReadOutcome, WriteOutcome } from '../api/github';
import { isRemoteVersionSupported, mergeLibraries, type MergeStats } from './merge';
import { commitMessage, parseRemoteLibrary, type SyncReport } from './syncEngine';
import {
  LEGACY_PATH,
  MANIFEST_PATH,
  assembleLibrary,
  groupWordsByBook,
  parseManifest,
  parseShard,
  planShardsToSync,
  shardPath,
  shardRevision,
  splitIntoShards,
  type Manifest,
  type Shard,
} from './shards';

/**
 * Sync across one file per book.
 *
 * The order of operations is the safety design:
 *
 * 1. Read the manifest, then only the books either side has touched.
 * 2. Merge, and write locally first — so a failed push still leaves this device better
 *    off than it started.
 * 3. Write shards, then the manifest **last**. The manifest can then only lag behind
 *    reality, costing a missed fetch that heals on the writer's next sync. Writing it
 *    first would have it advertise revisions that do not exist.
 * 4. Record the agreed revisions only after everything above succeeded.
 *
 * A conflict on any file abandons the attempt and starts over, re-reading everything.
 * Retrying a single file against a manifest read before the conflict would be reasoning
 * from a state that no longer exists.
 */

export interface ShardedSyncIO {
  readLocal: () => Promise<LibraryData>;
  writeLocal: (data: LibraryData) => Promise<void>;
  readFile: (path: string) => Promise<ReadOutcome>;
  writeFile: (
    path: string,
    text: string,
    sha: string | undefined,
    message: string,
  ) => Promise<WriteOutcome>;
  /** Revisions this device last agreed with the remote, per book. */
  readKnownRevisions: () => Promise<Record<string, string>>;
  writeKnownRevisions: (revisions: Record<string, string>) => Promise<void>;
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Maps a failed read onto a report; null when the read was usable. */
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

/** Maps a failed write onto a report; null for success, 'conflict' handled by caller. */
function reportForWrite(outcome: WriteOutcome): SyncReport | null {
  switch (outcome.status) {
    case 'ok':
    case 'conflict':
      return null;
    case 'too-large':
      return { status: 'too-large', bytes: outcome.bytes, limitBytes: outcome.limitBytes };
    case 'error':
      return { status: 'error', message: outcome.message };
    default:
      return { status: outcome.status };
  }
}

interface FetchedShard {
  shard: Shard;
  sha: string | undefined;
}

const DEFAULT_MAX_ATTEMPTS = 3;

export async function runShardedSync(
  io: ShardedSyncIO,
  options: { maxAttempts?: number } = {},
): Promise<SyncReport> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Re-read local each attempt: a word may have been captured while we retried.
    const local = await io.readLocal();
    const known = await io.readKnownRevisions();

    /* ---------------------------------------------------------- manifest */

    const manifestRead = await io.readFile(MANIFEST_PATH);
    const manifestFailure = reportForRead(manifestRead);
    if (manifestFailure) return manifestFailure;

    let manifest: Manifest = { version: SCHEMA_VERSION, books: [], shards: {} };
    let manifestSha: string | undefined;
    /** Set when a pre-sharding single file has to be folded in first. */
    let legacyLibrary: LibraryData | null = null;

    if (manifestRead.status === 'ok') {
      const parsed = parseManifest(manifestRead.text);
      if (!parsed.ok) return { status: 'remote-invalid', message: parsed.message };
      manifest = parsed.value;
      manifestSha = manifestRead.sha;
    } else {
      // No manifest yet — either a first sync, or a library still in the old layout.
      const legacyRead = await io.readFile(LEGACY_PATH);
      const legacyFailure = reportForRead(legacyRead);
      if (legacyFailure) return legacyFailure;

      if (legacyRead.status === 'ok') {
        const parsed = parseRemoteLibrary(legacyRead.text);
        if (!parsed.ok) return { status: 'remote-invalid', message: parsed.message };
        if (!isRemoteVersionSupported(parsed.value.data.version)) return { status: 'app-outdated' };
        legacyLibrary = parsed.value.data;
      }
    }

    if (!isRemoteVersionSupported(manifest.version)) return { status: 'app-outdated' };

    /* ------------------------------------------------------------ shards */

    const fetched = new Map<string, FetchedShard>();
    let remote: LibraryData;

    if (legacyLibrary) {
      // Everything arrives in one piece; there is nothing to plan.
      remote = legacyLibrary;
    } else {
      const plan = planShardsToSync({
        localWordsByBook: groupWordsByBook(local.words),
        localBookIds: local.books.map((book) => book.id),
        remoteRevisions: manifest.shards,
        knownRevisions: known,
      });

      for (const bookId of plan) {
        const read = await io.readFile(shardPath(bookId));
        const failure = reportForRead(read);
        if (failure) return failure;

        if (read.status === 'ok') {
          const parsed = parseShard(read.text, bookId);
          if (!parsed.ok) return { status: 'remote-invalid', message: parsed.message };
          fetched.set(bookId, { shard: parsed.value, sha: read.sha });
        } else {
          // Advertised but absent: treat as empty, and create it on the way out.
          fetched.set(bookId, {
            shard: { version: SCHEMA_VERSION, bookId, words: [] },
            sha: undefined,
          });
        }
      }

      /**
       * Only fetched shards contribute. That is safe because merging is a union — a word
       * absent from the remote side is never treated as deleted, only as unseen.
       */
      remote = assembleLibrary(
        manifest,
        [...fetched.values()].map((entry) => entry.shard),
      );
    }

    const outcome = mergeLibraries(local, remote);

    // Apply what the other device knew before pushing anything.
    if (outcome.changedLocal) await io.writeLocal(outcome.merged);

    /* ------------------------------------------------------------ writes */

    const split = splitIntoShards(outcome.merged);
    const nextRevisions: Record<string, string> = { ...known };
    let conflicted = false;
    let pushed = false;

    for (const shard of split.shards) {
      const revision = split.manifest.shards[shard.bookId];
      const seen = fetched.get(shard.bookId);

      // A book nobody touched this round keeps whatever we last agreed.
      if (!legacyLibrary && !seen) {
        if (known[shard.bookId] !== undefined) continue;
        // Never synced and never planned shouldn't happen, but don't invent agreement.
        nextRevisions[shard.bookId] = revision;
        continue;
      }

      const remoteRevision = seen ? shardRevision(seen.shard.words) : undefined;
      if (remoteRevision === revision) {
        nextRevisions[shard.bookId] = revision;
        continue;
      }

      const write = await io.writeFile(
        shardPath(shard.bookId),
        serialize(shard),
        seen?.sha,
        commitMessage(outcome.stats),
      );

      if (write.status === 'conflict') {
        conflicted = true;
        break;
      }
      const failure = reportForWrite(write);
      if (failure) return failure;

      nextRevisions[shard.bookId] = revision;
      pushed = true;
    }

    if (conflicted) continue;

    /* ---------------------------------------------------------- manifest */

    const nextManifest: Manifest = {
      version: SCHEMA_VERSION,
      books: split.manifest.books,
      shards: { ...manifest.shards, ...split.manifest.shards },
    };

    const manifestChanged =
      legacyLibrary !== null ||
      manifestRead.status !== 'ok' ||
      serialize(nextManifest) !== serialize(manifest);

    if (manifestChanged) {
      const write = await io.writeFile(
        MANIFEST_PATH,
        serialize(nextManifest),
        manifestSha,
        commitMessage(outcome.stats),
      );

      if (write.status === 'conflict') continue;
      const failure = reportForWrite(write);
      if (failure) return failure;
      pushed = true;
    }

    /**
     * Retire the old single file by leaving a version marker behind. An app that still
     * reads `library.json` then refuses it outright instead of quietly maintaining a
     * second, diverging copy of the library.
     */
    if (legacyLibrary) {
      const tripwire = await io.readFile(LEGACY_PATH);
      if (tripwire.status === 'ok') {
        const write = await io.writeFile(
          LEGACY_PATH,
          serialize({ version: SCHEMA_VERSION, books: [], words: [] }),
          tripwire.sha,
          'Moved to per-book files',
        );
        if (write.status === 'conflict') continue;
        const failure = reportForWrite(write);
        if (failure) return failure;
      }
    }

    // Recorded only once every write above succeeded, so a failure re-plans next time.
    await io.writeKnownRevisions(nextRevisions);

    return {
      status: 'synced',
      stats: outcome.stats satisfies MergeStats,
      pulled: outcome.changedLocal,
      pushed,
    };
  }

  return { status: 'conflict-unresolved', attempts: maxAttempts };
}

/** Exposed for tests: an empty library in the current format. */
export const freshLibrary = emptyLibrary;
