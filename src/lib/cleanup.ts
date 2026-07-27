/**
 * Retired runtime caches.
 *
 * Workbox cleans up its own precache between versions, but a runtime cache created by
 * a rule that has since been deleted is left behind untouched — the rule that would
 * have managed it no longer exists. Naming retired caches here lets existing installs
 * reclaim the space instead of carrying it forever.
 *
 * `ks-covers` held opaque cross-origin cover images, which Chrome pads heavily; a
 * dozen of them accounted for tens of megabytes of reported usage.
 */
const RETIRED_CACHES = ['ks-covers'];

/** Idempotent and safe to call on every start; deleting a missing cache is a no-op. */
export async function deleteRetiredCaches(): Promise<void> {
  if (typeof caches === 'undefined') return;

  await Promise.all(
    RETIRED_CACHES.map((name) => caches.delete(name).catch(() => false)),
  );
}
