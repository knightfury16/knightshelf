/**
 * This device's name, as it appears in the data repository's commit history.
 *
 * Sync authenticates with one personal access token, so every commit is attributed to the
 * same GitHub account no matter which machine pushed it. The name is what distinguishes
 * them — it goes into the commit message, and nowhere else. It is deliberately not written
 * into the synced files: identity in `manifest.json` would push-loop forever, and identity
 * on records would grow every row and shift how the merge breaks ties.
 *
 * Generated on first use rather than asked for, so a fresh device can sync before anyone
 * has thought about naming it, and renameable afterwards because "Brave Otter" tells you
 * nothing about which machine it is.
 *
 * Stored per origin *and per browser profile*, which is the honest granularity: two
 * browsers on one machine are two devices as far as this can tell.
 */

const STORAGE_KEY = 'knightshelf.device';

/** 30 × 30 = 900 pairs. Two devices can collide; renaming is the way out. */
const ADJECTIVES = [
  'amber', 'brave', 'bright', 'calm', 'clever', 'copper', 'dusky', 'eager',
  'gentle', 'golden', 'hidden', 'humble', 'ivory', 'jolly', 'keen', 'lively',
  'lunar', 'mellow', 'noble', 'patient', 'quiet', 'rapid', 'rustic', 'silent',
  'silver', 'slender', 'swift', 'tidy', 'velvet', 'wandering',
] as const;

const ANIMALS = [
  'otter', 'heron', 'marten', 'ibis', 'badger', 'lynx', 'kestrel', 'hare',
  'raven', 'stoat', 'osprey', 'pika', 'gannet', 'weasel', 'curlew', 'plover',
  'shrew', 'wren', 'dipper', 'merlin', 'sable', 'vole', 'godwit', 'fulmar',
  'linnet', 'tanager', 'skua', 'grebe', 'teal', 'lapwing',
] as const;

/** Capped so a name can never dominate a commit message subject line. */
export const MAX_DEVICE_NAME_LENGTH = 32;

/**
 * Letters, digits, spaces and hyphens. Unicode letter classes rather than A–Z, so a name
 * in any script is accepted — the restriction exists to keep commit subjects clean, not to
 * insist on English.
 */
const ALLOWED = /^[\p{L}\p{N} -]+$/u;

/**
 * A float in [0, 1).
 *
 * Unlike `newId`, this falls back to `Math.random` instead of throwing. A name is a
 * cosmetic label, not an identifier — a device with no secure random source should still
 * be able to sync, and the worst case is a slightly less uniform choice of animal.
 */
function defaultRandom(): number {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const [value] = crypto.getRandomValues(new Uint32Array(1));
    return value / 2 ** 32;
  }
  return Math.random();
}

function pick<T>(items: readonly T[], random: () => number): T {
  // Clamped: an injected random returning exactly 1 would otherwise index past the end.
  const index = Math.min(items.length - 1, Math.floor(random() * items.length));
  return items[index];
}

function titleCase(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/** `random` is injectable so tests can pin the result. */
export function generateDeviceName(random: () => number = defaultRandom): string {
  return `${titleCase(pick(ADJECTIVES, random))} ${titleCase(pick(ANIMALS, random))}`;
}

export type DeviceNameCheck = { ok: true } | { ok: false; message: string };

export function validateDeviceName(name: string): DeviceNameCheck {
  const trimmed = name.trim();

  if (trimmed.length === 0) {
    return { ok: false, message: 'Give this device a name.' };
  }
  if (trimmed.length > MAX_DEVICE_NAME_LENGTH) {
    return {
      ok: false,
      message: `Keep it to ${MAX_DEVICE_NAME_LENGTH} characters or fewer.`,
    };
  }
  if (!ALLOWED.test(trimmed)) {
    return { ok: false, message: 'Letters, numbers, spaces and hyphens only.' };
  }

  return { ok: true };
}

function readStored(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw && raw.trim().length > 0 ? raw : null;
  } catch {
    // Storage blocked (private mode); a name is generated per session instead.
    return null;
  }
}

let cached: string | null = null;

/**
 * This device's name, generating and persisting one the first time it is asked for.
 *
 * Never throws and never returns empty, because the sync engine calls it while building a
 * commit message and a missing name must not be able to stop a push.
 */
export function deviceName(): string {
  if (cached) return cached;

  const stored = readStored();
  if (stored) {
    cached = stored;
    return stored;
  }

  const generated = generateDeviceName();
  cached = generated;
  try {
    localStorage.setItem(STORAGE_KEY, generated);
  } catch {
    // Non-fatal: the name holds for this session and is regenerated next time.
  }
  return generated;
}

/** Caller is expected to have checked `validateDeviceName` first. */
export function setDeviceName(name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;

  cached = trimmed;
  try {
    localStorage.setItem(STORAGE_KEY, trimmed);
  } catch {
    // Non-fatal: the rename holds for this session.
  }
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function resetDeviceNameCache(): void {
  cached = null;
}
