/**
 * Core domain types.
 *
 * Two constraints shape everything here, both from Phase 2 (GitHub sync):
 *
 * 1. Records are append-mostly and carry `updatedAt`, so merging two devices
 *    is a union by id with newest-wins on edits — not a conflict to resolve.
 * 2. Deletes are soft (`deletedAt`). A hard delete on your phone would be
 *    resurrected by the next merge from your laptop, which still has the row.
 */

/**
 * Sync format version.
 *
 * 1 — a single file holding every book and word, with all senses.
 * 2 — records hold only the sense the reader kept, without synonyms; the full list
 *     lives in the local lookup cache, which is never synced.
 * 3 — split across files: a manifest of books, plus one file per book's words.
 *
 * Older formats stay readable so they can be migrated. An older *app* refuses a newer
 * file outright rather than silently dropping fields it doesn't understand.
 */
export const SCHEMA_VERSION = 3;

/** One dictionary sense. A word like "sheet" has several wildly different ones. */
export type Sense = {
  partOfSpeech: string;
  definition: string;
  example?: string;
  synonyms?: string[];
};

export type BookStatus = 'reading' | 'finished' | 'shelved';

export type Book = {
  id: string;
  title: string;
  author?: string;
  /** Open Library cover, or undefined for manually-added books. */
  coverUrl?: string;
  isbn?: string;
  status: BookStatus;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string;
  deletedAt?: string;
};

/**
 * `pending` means the word was captured with no network — reading in bed, on a
 * train — and the definition still needs fetching. The word is never lost to a
 * dead connection.
 */
export type LookupState = 'resolved' | 'pending' | 'notfound';

export type Word = {
  id: string;
  bookId: string;
  /** As looked up, lowercased for matching; display uses this verbatim. */
  term: string;
  /**
   * Only the sense you kept — at most one entry, and never with synonyms. Everything
   * else the dictionary returned lives in the local lookup cache, which is not synced.
   * `lib/senses.ts` explains why the shape has to be identical on every device.
   */
  senses: Sense[];
  /** Always 0 from version 2 onwards. Retained so version 1 files stay readable. */
  primarySense: number;
  phonetic?: string;
  audioUrl?: string;
  /** The sentence from your book. The one thing you can never reconstruct later. */
  contextSentence?: string;
  page?: string;
  note?: string;
  starred: boolean;
  lookupState: LookupState;
  addedAt: string;
  updatedAt: string;
  deletedAt?: string;
};

export type LibraryData = {
  version: number;
  books: Book[];
  words: Word[];
};

export const emptyLibrary = (): LibraryData => ({
  version: SCHEMA_VERSION,
  books: [],
  words: [],
});
