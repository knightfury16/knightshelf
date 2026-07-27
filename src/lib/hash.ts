/**
 * Deterministic small hash (FNV-1a) used for cosmetic variation.
 *
 * Real books on a shelf aren't uniform heights, so covers get slightly different
 * ones. That has to be stable per book — deriving it from the id means a book
 * doesn't visibly resize on every re-render the way Math.random() would cause.
 */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Maps an id to one of `count` buckets, stably. */
export function bucket(input: string, count: number): number {
  return hashString(input) % count;
}
