/**
 * Open Library — keyless book search and cover art.
 *
 * Responses are narrowed from `unknown`, same as the dictionary client.
 */

const SEARCH_ENDPOINT = 'https://openlibrary.org/search.json';
const COVER_BASE = 'https://covers.openlibrary.org/b/id';
const REQUEST_TIMEOUT_MS = 8000;
const RESULT_LIMIT = 12;

/**
 * Requesting explicit fields keeps the payload small on mobile data. `isbn` is
 * deliberately excluded: it returns every edition's ISBN, which can run to
 * hundreds of entries per work.
 */
const FIELDS = 'key,title,author_name,cover_i,first_publish_year';

export interface BookSearchResult {
  /** Open Library work key, e.g. `/works/OL27448W`. Used only to key the result list. */
  key: string;
  title: string;
  author?: string;
  coverUrl?: string;
  year?: number;
}

export type CoverSize = 'S' | 'M' | 'L';

/**
 * `M` is roughly 180px wide. `L` (~500px) matches the shelf's device pixels more
 * exactly on a high-DPI phone, but costs several times the bytes for artwork that is
 * decorative — so `M` is the default and the slight softening is an accepted trade.
 */
export function coverUrlForId(coverId: number, size: CoverSize = 'M'): string {
  return `${COVER_BASE}/${coverId}-${size}.jpg`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstAuthor(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  for (const item of value) {
    const name = asText(item);
    if (name) return name;
  }
  return undefined;
}

function asPositiveInt(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export type BookSearchOutcome =
  | { status: 'ok'; results: BookSearchResult[] }
  | { status: 'unavailable' };

/**
 * Title search. Pass an AbortSignal so debounced typing cancels stale requests
 * rather than racing them.
 */
export async function searchBooks(
  query: string,
  signal?: AbortSignal,
): Promise<BookSearchOutcome> {
  const trimmed = query.trim();
  if (!trimmed) return { status: 'ok', results: [] };

  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set('q', trimmed);
  url.searchParams.set('limit', String(RESULT_LIMIT));
  url.searchParams.set('fields', FIELDS);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Includes deliberate aborts from a superseded keystroke.
    return { status: 'unavailable' };
  }

  if (!response.ok) return { status: 'unavailable' };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'unavailable' };
  }

  if (!isRecord(payload) || !Array.isArray(payload.docs)) {
    return { status: 'ok', results: [] };
  }

  const results: BookSearchResult[] = [];
  for (const doc of payload.docs) {
    if (!isRecord(doc)) continue;
    const title = asText(doc.title);
    if (!title) continue;

    const coverId = asPositiveInt(doc.cover_i);
    results.push({
      key: asText(doc.key) ?? `${title}-${results.length}`,
      title,
      author: firstAuthor(doc.author_name),
      coverUrl: coverId ? coverUrlForId(coverId) : undefined,
      year: asPositiveInt(doc.first_publish_year),
    });
  }

  return { status: 'ok', results };
}
