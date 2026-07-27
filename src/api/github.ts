import { decodeBase64, encodeBase64 } from '../lib/base64';

/**
 * GitHub Contents API client, for reading and writing one JSON file in a private repo.
 *
 * Security rules this module exists to enforce:
 * - The token appears **only** in an `Authorization` header. Never in a URL, a query
 *   string, a log line, or a returned error message.
 * - The host is a hardcoded constant, never assembled from stored config, so a
 *   tampered setting cannot redirect credentials to another server.
 * - Outcomes are a closed set of typed results rather than thrown errors, so every
 *   failure the user can hit has somewhere specific to be explained.
 */

const API_ROOT = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * The Contents API tops out around 1 MB per file. At roughly 600 bytes per word that
 * is ~1,500 words — reachable for a committed reader, so it is reported explicitly
 * rather than left to fail obscurely. Passing it requires the Git Data API
 * (blob → tree → commit → ref), which is deliberately not built yet.
 */
export const MAX_FILE_BYTES = 1_000_000;

export interface SyncTarget {
  owner: string;
  repo: string;
  /** Path within the repo, e.g. `library.json`. */
  path: string;
  token: string;
}

export type ReadOutcome =
  | { status: 'ok'; text: string; sha: string }
  /** Repo reachable, file not created yet — the normal first-run state. */
  | { status: 'empty' }
  /** Token rejected: wrong, revoked, or expired. */
  | { status: 'unauthorized' }
  /** Repo missing, or this token has no access to it. */
  | { status: 'no-access' }
  | { status: 'offline' }
  | { status: 'rate-limited' }
  | { status: 'too-large'; limitBytes: number }
  | { status: 'error'; message: string };

export type WriteOutcome =
  | { status: 'ok'; sha: string }
  /** Someone else wrote first; caller must re-read, re-merge and retry. */
  | { status: 'conflict' }
  | { status: 'unauthorized' }
  | { status: 'no-access' }
  | { status: 'offline' }
  | { status: 'rate-limited' }
  | { status: 'too-large'; bytes: number; limitBytes: number }
  | { status: 'error'; message: string };

export type AccessOutcome =
  | { status: 'ok'; private: boolean }
  | { status: 'unauthorized' }
  | { status: 'no-access' }
  | { status: 'offline' }
  | { status: 'rate-limited' }
  | { status: 'error'; message: string };

function headers(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
}

function contentsUrl(target: SyncTarget): string {
  // Each segment is encoded separately so a slash in `path` stays a path separator.
  const path = target.path
    .split('/')
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/');
  return `${API_ROOT}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}/contents/${path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A 403 is rate limiting only when the remaining quota is actually zero. */
function isRateLimited(response: Response): boolean {
  if (response.status === 429) return true;
  return response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0';
}

/** Never surfaces a response body, which could contain anything. */
function describeStatus(response: Response): string {
  return `GitHub responded ${response.status} ${response.statusText}`.trim();
}

export async function verifyAccess(target: SyncTarget): Promise<AccessOutcome> {
  let response: Response;
  try {
    response = await fetch(
      `${API_ROOT}/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
      { headers: headers(target.token), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    );
  } catch {
    return { status: 'offline' };
  }

  if (response.status === 401) return { status: 'unauthorized' };
  if (isRateLimited(response)) return { status: 'rate-limited' };
  if (response.status === 403 || response.status === 404) return { status: 'no-access' };
  if (!response.ok) return { status: 'error', message: describeStatus(response) };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error', message: 'GitHub returned a response we could not read.' };
  }

  return {
    status: 'ok',
    private: isRecord(payload) && payload.private === true,
  };
}

export async function readLibraryFile(target: SyncTarget): Promise<ReadOutcome> {
  let response: Response;
  try {
    response = await fetch(contentsUrl(target), {
      headers: headers(target.token),
      // Avoid any intermediary cache serving a stale sha, which would look like a conflict.
      cache: 'no-store',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 'offline' };
  }

  if (response.status === 401) return { status: 'unauthorized' };
  if (isRateLimited(response)) return { status: 'rate-limited' };

  if (response.status === 404) {
    /**
     * GitHub returns 404 both for "this file does not exist yet" and for "this repo is
     * invisible to your token" — states needing completely different advice. Asking
     * about the repo separates them.
     */
    const access = await verifyAccess(target);
    if (access.status === 'ok') return { status: 'empty' };
    if (access.status === 'unauthorized') return { status: 'unauthorized' };
    if (access.status === 'offline') return { status: 'offline' };
    if (access.status === 'rate-limited') return { status: 'rate-limited' };
    return { status: 'no-access' };
  }

  if (response.status === 403) return { status: 'no-access' };
  if (!response.ok) return { status: 'error', message: describeStatus(response) };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error', message: 'GitHub returned a response we could not read.' };
  }

  if (!isRecord(payload) || typeof payload.sha !== 'string') {
    return { status: 'error', message: 'GitHub returned an unexpected file record.' };
  }

  // Past ~1 MB the API stops inlining content and reports `encoding: "none"`.
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string') {
    return { status: 'too-large', limitBytes: MAX_FILE_BYTES };
  }

  try {
    return { status: 'ok', text: decodeBase64(payload.content), sha: payload.sha };
  } catch {
    return { status: 'error', message: 'The stored file could not be decoded.' };
  }
}

export async function writeLibraryFile(
  target: SyncTarget,
  text: string,
  /** Omit only when creating the file for the first time. */
  sha: string | undefined,
  message: string,
): Promise<WriteOutcome> {
  const bytes = new TextEncoder().encode(text).length;
  if (bytes > MAX_FILE_BYTES) {
    return { status: 'too-large', bytes, limitBytes: MAX_FILE_BYTES };
  }

  let response: Response;
  try {
    response = await fetch(contentsUrl(target), {
      method: 'PUT',
      headers: { ...headers(target.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: encodeBase64(text),
        // Omitting sha on an existing file is what GitHub reports as a conflict.
        ...(sha ? { sha } : {}),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { status: 'offline' };
  }

  if (response.status === 401) return { status: 'unauthorized' };
  if (isRateLimited(response)) return { status: 'rate-limited' };
  // 409 is the documented conflict; 422 covers a stale or missing sha.
  if (response.status === 409 || response.status === 422) return { status: 'conflict' };
  if (response.status === 403) return { status: 'no-access' };
  if (response.status === 404) return { status: 'no-access' };
  if (!response.ok) return { status: 'error', message: describeStatus(response) };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'error', message: 'GitHub returned a response we could not read.' };
  }

  const content = isRecord(payload) ? payload.content : undefined;
  const nextSha = isRecord(content) && typeof content.sha === 'string' ? content.sha : undefined;
  if (!nextSha) {
    return { status: 'error', message: 'GitHub did not return the new file revision.' };
  }

  return { status: 'ok', sha: nextSha };
}
