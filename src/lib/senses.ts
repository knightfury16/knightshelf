import type { Sense, Word } from '../types';

/**
 * The single definition of what a *stored* word looks like.
 *
 * A record keeps only the sense the reader chose, without synonyms. Everything else
 * the dictionary returned — the other senses, the synonyms — lives in the local lookup
 * cache, which is never synced.
 *
 * The split is not merely about size. The merge picks a winner by comparing records, so
 * if a device held twelve senses while the synced file held one, the merge would see a
 * false difference and could quietly strip the device's list — getting worse every
 * sync. Keeping records identical in shape everywhere removes that failure entirely.
 *
 * `trimWord` must be idempotent: it runs on load, on read from the file, and on every
 * write, and each pass has to be a no-op once the shape is right.
 */

/** The sense the reader kept, if any. */
export function keptSense(word: Word): Sense | undefined {
  return word.senses[word.primarySense] ?? word.senses[0];
}

/**
 * Storage form of a sense.
 *
 * Synonyms are dropped: nothing renders them from a record, they are re-fetchable, and
 * at up to eight per sense they were pure weight in the synced file.
 */
export function senseForRecord(sense: Sense): Sense {
  const trimmed: Sense = {
    partOfSpeech: sense.partOfSpeech,
    definition: sense.definition,
  };
  // Examples are kept — the entry displays them, and they are rare enough to be cheap.
  if (sense.example) trimmed.example = sense.example;
  return trimmed;
}

/** True when the record already holds at most the kept sense, free of synonyms. */
export function isTrimmed(word: Word): boolean {
  if (word.primarySense !== 0) return false;
  if (word.senses.length > 1) return false;
  return word.senses.length === 0 || word.senses[0].synonyms === undefined;
}

/**
 * Reduces a word to its stored shape. Returns the original object untouched when it is
 * already correct, so callers can skip pointless writes and avoid sync churn.
 */
export function trimWord(word: Word): Word {
  if (isTrimmed(word)) return word;

  const kept = keptSense(word);
  return {
    ...word,
    senses: kept ? [senseForRecord(kept)] : [],
    primarySense: 0,
  };
}

/** Convenience for a whole collection, preserving object identity where possible. */
export function trimWords(words: Word[]): Word[] {
  return words.map(trimWord);
}

/**
 * Which cached sense corresponds to the one on the record.
 *
 * Matched on the definition text rather than an index: the dictionary can return a
 * different number of senses in a different order after a refetch, and an index would
 * silently start pointing at another meaning.
 */
export function indexOfKeptSense(word: Word, candidates: Sense[]): number {
  const kept = keptSense(word);
  if (!kept) return -1;
  return candidates.findIndex((candidate) => candidate.definition === kept.definition);
}

/** Synonyms for the kept sense, from cached candidates. Never stored on the record. */
export function synonymsForKeptSense(word: Word, candidates: Sense[]): string[] {
  const index = indexOfKeptSense(word, candidates);
  if (index === -1) return [];
  return candidates[index].synonyms ?? [];
}
