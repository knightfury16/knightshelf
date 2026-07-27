/**
 * Sync configuration in localStorage.
 *
 * The token is stored under its own key, separate from the repository details, so
 * disconnecting can wipe the credential while remembering where to reconnect to.
 *
 * It is stored in plaintext. That is a deliberate, documented trade rather than an
 * oversight: a static site has no server to hold a secret, and encrypting it with a key
 * that also lives in the same localStorage would be theatre. The real defence is the
 * token's scope — one private repo, contents only — so a stolen token yields a word
 * list and nothing else.
 */

const REPO_KEY = 'knightshelf.sync.repo';
const TOKEN_KEY = 'knightshelf.sync.token';

/** Default file name inside the data repository. */
export const DEFAULT_PATH = 'library.json';

export interface RepoRef {
  owner: string;
  repo: string;
  path: string;
}

export interface SyncConfig extends RepoRef {
  token: string;
}

/**
 * Accepts what someone is likely to paste: `owner/repo`, a browser URL, or an SSH-ish
 * form. Returns null when it cannot be read confidently, rather than guessing.
 */
export function parseRepoInput(input: string, path: string = DEFAULT_PATH): RepoRef | null {
  let text = input.trim();
  if (!text) return null;

  text = text
    .replace(/^https?:\/\//i, '')
    .replace(/^git@/i, '')
    .replace(/^github\.com[/:]/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  const segments = text.split('/').filter(Boolean);
  if (segments.length !== 2) return null;

  const [owner, repo] = segments;
  // GitHub's own rules for account and repository names.
  if (!/^[A-Za-z0-9-]+$/.test(owner)) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(repo)) return null;

  return { owner, repo, path: path.trim() || DEFAULT_PATH };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readRepoRef(): RepoRef | null {
  try {
    const raw = localStorage.getItem(REPO_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const { owner, repo, path } = parsed;
    if (typeof owner !== 'string' || typeof repo !== 'string') return null;

    return { owner, repo, path: typeof path === 'string' && path ? path : DEFAULT_PATH };
  } catch {
    return null;
  }
}

export function readToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function readSyncConfig(): SyncConfig | null {
  const ref = readRepoRef();
  const token = readToken();
  if (!ref || !token) return null;
  return { ...ref, token };
}

export function saveSyncConfig(config: SyncConfig): void {
  try {
    localStorage.setItem(
      REPO_KEY,
      JSON.stringify({ owner: config.owner, repo: config.repo, path: config.path }),
    );
    localStorage.setItem(TOKEN_KEY, config.token);
  } catch {
    // Storage blocked; sync stays configured for this session only.
  }
}

/** Removes the credential and, unless asked to keep it, the repository too. */
export function clearSyncConfig(options: { keepRepo?: boolean } = {}): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    if (!options.keepRepo) localStorage.removeItem(REPO_KEY);
  } catch {
    // Nothing useful to do if storage is unavailable.
  }
}
