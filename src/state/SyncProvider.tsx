import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import * as store from '../db/store';
import { readLibraryFile, verifyAccess, writeLibraryFile } from '../api/github';
import { runSync, type SyncIO, type SyncReport } from '../lib/syncEngine';
import { stableStringify } from '../lib/merge';
import { nowIso } from '../lib/id';
import { useLibrary } from './LibraryContext';
import {
  clearSyncConfig,
  parseRepoInput,
  readRepoRef,
  readSyncConfig,
  readToken,
  saveSyncConfig,
  type RepoRef,
} from './syncConfig';
import { SyncContext, type ConnectOutcome, type SyncActivity, type SyncValue } from './SyncContext';

/**
 * Orchestration: when to sync, and keeping the in-memory library in step afterwards.
 *
 * All the decision-making lives in `runSync`, which is unit-tested with fakes. This
 * component only supplies real IO and decides on timing.
 */

const LAST_SYNCED_KEY = 'knightshelf.sync.lastAt';
const PUBLIC_REPO_KEY = 'knightshelf.sync.publicRepo';

/** Long enough to batch a burst of edits, short enough to feel automatic. */
const PUSH_DEBOUNCE_MS = 4000;

function readStoredString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStoredString(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Non-fatal; only affects what we can show about the last sync.
  }
}

export function SyncProvider({ children }: { children: ReactNode }) {
  const { books, words, reload, status } = useLibrary();

  const [repo, setRepo] = useState<RepoRef | null>(() => readRepoRef());
  const [hasToken, setHasToken] = useState<boolean>(() => readToken() !== null);
  const [activity, setActivity] = useState<SyncActivity>('idle');
  const [lastReport, setLastReport] = useState<SyncReport | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(() =>
    readStoredString(LAST_SYNCED_KEY),
  );
  const [repoIsPublic, setRepoIsPublic] = useState<boolean>(
    () => readStoredString(PUBLIC_REPO_KEY) === 'true',
  );

  const configured = repo !== null && hasToken;

  /** Guards against overlapping runs, which would race each other's writes. */
  const runningRef = useRef(false);

  /**
   * Fingerprint of the data as it stood after the last successful sync.
   *
   * Without this, a sync that pulls changes writes locally, which changes `books` and
   * `words`, which re-triggers the debounced push — an endless round trip. Comparing
   * fingerprints means only genuine local edits schedule a push.
   */
  const syncedFingerprintRef = useRef<string | null>(null);

  const syncNow = useCallback(async (): Promise<void> => {
    const config = readSyncConfig();
    if (!config || runningRef.current) return;

    runningRef.current = true;
    setActivity('syncing');

    try {
      const io: SyncIO = {
        readLocal: () => store.exportLibrary(),
        writeLocal: async (data) => {
          await store.writeRecords(data.books, data.words);
          // Bring the in-memory copy back in step with what just landed on disk.
          await reload();
        },
        readRemote: () => readLibraryFile(config),
        writeRemote: (text, sha, message) => writeLibraryFile(config, text, sha, message),
      };

      const report = await runSync(io);
      setLastReport(report);

      if (report.status === 'synced') {
        const stamp = nowIso();
        setLastSyncedAt(stamp);
        writeStoredString(LAST_SYNCED_KEY, stamp);

        const snapshot = await store.exportLibrary();
        syncedFingerprintRef.current = stableStringify(snapshot);
      }
    } catch {
      setLastReport({ status: 'error', message: 'Sync stopped unexpectedly.' });
    } finally {
      runningRef.current = false;
      setActivity('idle');
    }
  }, [reload]);

  /**
   * Pull as soon as the app opens, so another device's words are there before you read.
   *
   * Gated on the library being ready, because loading also runs the sense-trimming
   * migration: syncing first could merge a record into its trimmed shape before the
   * full sense list had been preserved in the local cache.
   */
  useEffect(() => {
    if (configured && status === 'ready') void syncNow();
  }, [configured, status, syncNow]);

  // Push a while after the last edit, rather than on every keystroke.
  useEffect(() => {
    if (!configured) return;

    const timer = setTimeout(() => {
      void (async () => {
        const snapshot = await store.exportLibrary();
        if (stableStringify(snapshot) === syncedFingerprintRef.current) return;
        await syncNow();
      })();
    }, PUSH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [books, words, configured, syncNow]);

  useEffect(() => {
    if (!configured) return;

    const onOnline = () => void syncNow();
    // Leaving the app is the last chance to flush before it may be frozen.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') void syncNow();
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [configured, syncNow]);

  const connect = useCallback(
    async (repoInput: string, token: string, path?: string): Promise<ConnectOutcome> => {
      const ref = parseRepoInput(repoInput, path);
      if (!ref) return { status: 'invalid-repo' };

      const trimmed = token.trim();
      if (!trimmed) return { status: 'missing-token' };

      // Verify before storing, so a typo never leaves a broken configuration behind.
      const access = await verifyAccess({ ...ref, token: trimmed });
      if (access.status !== 'ok') return access;

      saveSyncConfig({ ...ref, token: trimmed });
      writeStoredString(PUBLIC_REPO_KEY, access.private ? null : 'true');

      setRepo(ref);
      setHasToken(true);
      setRepoIsPublic(!access.private);
      syncedFingerprintRef.current = null;

      void syncNow();
      return { status: 'ok', private: access.private };
    },
    [syncNow],
  );

  const disconnect = useCallback((): void => {
    clearSyncConfig();
    writeStoredString(LAST_SYNCED_KEY, null);
    writeStoredString(PUBLIC_REPO_KEY, null);

    setRepo(null);
    setHasToken(false);
    setLastReport(null);
    setLastSyncedAt(null);
    setRepoIsPublic(false);
    syncedFingerprintRef.current = null;
  }, []);

  const value = useMemo<SyncValue>(
    () => ({
      activity: configured ? activity : 'unconfigured',
      repo,
      lastReport,
      lastSyncedAt,
      repoIsPublic,
      connect,
      disconnect,
      syncNow,
    }),
    [
      configured,
      activity,
      repo,
      lastReport,
      lastSyncedAt,
      repoIsPublic,
      connect,
      disconnect,
      syncNow,
    ],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}
