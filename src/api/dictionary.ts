import type { Sense } from '../types';
import { readCachedLookup, writeCachedLookup } from '../db/store';
import { nowIso } from '../lib/id';

/**
 * dictionaryapi.dev — free and, crucially, keyless. Any keyed dictionary API
 * (Merriam-Webster, Wordnik) would leave its key sitting in public JavaScript,
 * which rules them out for a static site.
 *
 * Responses are untrusted input: every field is narrowed from `unknown` before
 * it reaches the app, so a shape change upstream can't inject junk into storage.
 */

const ENDPOINT = 'https://api.dictionaryapi.dev/api/v2/entries/en';
const REQUEST_TIMEOUT_MS = 8000;

/** Some words carry 30+ senses. Keep the archive (and the sync file) sane. */
const MAX_SENSES = 12;

export type LookupOutcome =
  | { status: 'found'; senses: Sense[]; phonetic?: string; audioUrl?: string }
  | { status: 'notfound' }
  /** Network or server failure — distinct from notfound so the caller can queue and retry. */
  | { status: 'unavailable' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(asText).filter((item): item is string => item !== undefined);
  return items.length > 0 ? items.slice(0, 8) : undefined;
}

/** Protocol-relative audio URLs come back as `//ssl.gstatic.com/...`. */
function normalizeAudioUrl(value: unknown): string | undefined {
  const raw = asText(value);
  if (!raw) return undefined;
  const url = raw.startsWith('//') ? `https:${raw}` : raw;
  return url.startsWith('https://') ? url : undefined;
}

interface ParsedEntry {
  senses: Sense[];
  phonetic?: string;
  audioUrl?: string;
}

function parseEntries(payload: unknown): ParsedEntry {
  const senses: Sense[] = [];
  let phonetic: string | undefined;
  let audioUrl: string | undefined;

  if (!Array.isArray(payload)) return { senses };

  for (const entry of payload) {
    if (!isRecord(entry)) continue;

    phonetic ??= asText(entry.phonetic);

    if (Array.isArray(entry.phonetics)) {
      for (const item of entry.phonetics) {
        if (!isRecord(item)) continue;
        phonetic ??= asText(item.text);
        audioUrl ??= normalizeAudioUrl(item.audio);
      }
    }

    if (!Array.isArray(entry.meanings)) continue;

    for (const meaning of entry.meanings) {
      if (!isRecord(meaning)) continue;
      const partOfSpeech = asText(meaning.partOfSpeech) ?? 'other';
      if (!Array.isArray(meaning.definitions)) continue;

      for (const definition of meaning.definitions) {
        if (!isRecord(definition)) continue;
        const text = asText(definition.definition);
        if (!text) continue;

        senses.push({
          partOfSpeech,
          definition: text,
          example: asText(definition.example),
          synonyms: asStringArray(definition.synonyms),
        });

        if (senses.length >= MAX_SENSES) return { senses, phonetic, audioUrl };
      }
    }
  }

  return { senses, phonetic, audioUrl };
}

/**
 * Looks a word up, preferring the local cache.
 *
 * Cache hits keep repeat lookups instant and keep the archive readable with no
 * connection. Failures are never cached — only definitive found/notfound answers.
 */
export async function lookupWord(rawTerm: string): Promise<LookupOutcome> {
  const term = rawTerm.trim().toLowerCase();
  if (!term) return { status: 'notfound' };

  const cached = await readCachedLookup(term).catch(() => undefined);
  if (cached) {
    return cached.found
      ? {
          status: 'found',
          senses: cached.senses,
          phonetic: cached.phonetic,
          audioUrl: cached.audioUrl,
        }
      : { status: 'notfound' };
  }

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}/${encodeURIComponent(term)}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Offline, timed out, or DNS failure. The caller queues the word instead.
    return { status: 'unavailable' };
  }

  if (response.status === 404) {
    await writeCachedLookup({ term, found: false, senses: [], fetchedAt: nowIso() }).catch(
      () => undefined,
    );
    return { status: 'notfound' };
  }

  if (!response.ok) return { status: 'unavailable' };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { status: 'unavailable' };
  }

  const { senses, phonetic, audioUrl } = parseEntries(payload);

  // A 200 with nothing usable in it is, for our purposes, a miss.
  if (senses.length === 0) {
    await writeCachedLookup({ term, found: false, senses: [], fetchedAt: nowIso() }).catch(
      () => undefined,
    );
    return { status: 'notfound' };
  }

  await writeCachedLookup({
    term,
    found: true,
    senses,
    phonetic,
    audioUrl,
    fetchedAt: nowIso(),
  }).catch(() => undefined);

  return { status: 'found', senses, phonetic, audioUrl };
}
