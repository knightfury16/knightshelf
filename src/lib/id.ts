/**
 * Stable record ids.
 *
 * Ids are the merge key for Phase 2 sync, so they must be collision-free across
 * devices that have never seen each other. UUIDv4 from the platform CSPRNG gives
 * that without coordination.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Older WebViews: assemble a v4 from getRandomValues.
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  throw new Error('No secure random source available for id generation.');
}

/** ISO timestamp, the format `updatedAt` comparisons and the JSON file both use. */
export function nowIso(): string {
  return new Date().toISOString();
}
