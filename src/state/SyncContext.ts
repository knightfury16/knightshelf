import { createContext, useContext } from 'react';
import type { SyncReport } from '../lib/syncEngine';
import type { RepoRef } from './syncConfig';

/**
 * Context shape and consumer hook, kept apart from the provider component so this
 * module exports no components and Fast Refresh can hot-swap the provider.
 *
 * Note what is deliberately absent: the token. It never travels through context, so
 * no component can render or log it by accident.
 */

export type SyncActivity = 'unconfigured' | 'idle' | 'syncing';

export type ConnectOutcome =
  | { status: 'ok'; private: boolean }
  | { status: 'invalid-repo' }
  | { status: 'missing-token' }
  | { status: 'unauthorized' }
  | { status: 'no-access' }
  | { status: 'offline' }
  | { status: 'rate-limited' }
  | { status: 'error'; message: string };

export interface SyncValue {
  activity: SyncActivity;
  /** Where sync points, without the credential. */
  repo: RepoRef | null;
  /** Outcome of the most recent attempt, for messaging. */
  lastReport: SyncReport | null;
  lastSyncedAt: string | null;
  /** True when the stored repo is public — the words would be world-readable. */
  repoIsPublic: boolean;
  connect: (repoInput: string, token: string, path?: string) => Promise<ConnectOutcome>;
  disconnect: () => void;
  syncNow: () => Promise<void>;
}

export const SyncContext = createContext<SyncValue | null>(null);

export function useSync(): SyncValue {
  const value = useContext(SyncContext);
  if (!value) throw new Error('useSync must be used inside <SyncProvider>.');
  return value;
}
