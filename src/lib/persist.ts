/**
 * Persistent storage.
 *
 * By default browser storage is "best-effort": Chrome may evict an entire origin's
 * IndexedDB under disk pressure, no matter how little it holds. With no sync and no
 * server, that eviction is the single way this app can lose your words — so we ask
 * to be exempted.
 *
 * Chrome decides heuristically and shows no prompt; installed PWAs are usually
 * granted. Firefox prompts the user. Either way a refusal is not an error, just a
 * status worth surfacing.
 */

export interface StorageStatus {
  /** Whether the Storage API is available at all. */
  supported: boolean;
  /** True when the origin is exempt from eviction. */
  persisted: boolean;
  usageBytes?: number;
  quotaBytes?: number;
}

function hasStorageManager(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.storage !== 'undefined';
}

export async function readStorageStatus(): Promise<StorageStatus> {
  if (!hasStorageManager()) return { supported: false, persisted: false };

  const persisted =
    typeof navigator.storage.persisted === 'function'
      ? await navigator.storage.persisted().catch(() => false)
      : false;

  let usageBytes: number | undefined;
  let quotaBytes: number | undefined;

  if (typeof navigator.storage.estimate === 'function') {
    const estimate = await navigator.storage.estimate().catch(() => undefined);
    usageBytes = estimate?.usage;
    quotaBytes = estimate?.quota;
  }

  return { supported: true, persisted, usageBytes, quotaBytes };
}

/** Returns the resulting persisted state; false simply means the browser declined. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!hasStorageManager() || typeof navigator.storage.persist !== 'function') return false;

  // Already granted — asking again is a no-op but pointless.
  if (typeof navigator.storage.persisted === 'function') {
    const already = await navigator.storage.persisted().catch(() => false);
    if (already) return true;
  }

  return navigator.storage.persist().catch(() => false);
}
