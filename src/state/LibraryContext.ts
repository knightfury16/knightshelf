import { createContext, useContext } from 'react';
import type { Book, BookStatus, LookupState, Sense, Word } from '../types';

/**
 * Context shape and consumer hook.
 *
 * Kept apart from the provider component so this module exports no components —
 * which keeps React Fast Refresh able to hot-swap the provider without tearing
 * down the whole tree.
 */

export interface LibrarySnapshot {
  books: Book[];
  words: Word[];
  status: 'loading' | 'ready' | 'error';
  error?: string;
}

export interface NewBookInput {
  title: string;
  author?: string;
  coverUrl?: string;
  isbn?: string;
}

export interface NewWordInput {
  bookId: string;
  term: string;
  senses: Sense[];
  primarySense: number;
  lookupState: LookupState;
  phonetic?: string;
  audioUrl?: string;
  contextSentence?: string;
  page?: string;
  note?: string;
}

/**
 * Result of asking the dictionary again for a word already in the shelf.
 * `unavailable` means the network failed, so the record was left untouched.
 */
export type RefetchOutcome = 'updated' | 'notfound' | 'unavailable' | 'missing';

export interface LibraryValue extends LibrarySnapshot {
  createBook: (input: NewBookInput) => Promise<Book>;
  updateBook: (id: string, patch: Partial<Omit<Book, 'id'>>) => Promise<void>;
  setBookStatus: (id: string, status: BookStatus) => Promise<void>;
  deleteBook: (id: string) => Promise<void>;
  saveWord: (input: NewWordInput) => Promise<Word>;
  updateWord: (id: string, patch: Partial<Omit<Word, 'id' | 'bookId'>>) => Promise<void>;
  deleteWord: (id: string) => Promise<void>;
  /** Asks the dictionary again on demand, bypassing the cached answer. */
  refetchDefinition: (id: string) => Promise<RefetchOutcome>;
  /**
   * Re-reads everything from IndexedDB. Used after a sync merge writes records
   * underneath the in-memory copy.
   */
  reload: () => Promise<void>;
  /** Words captured with no connection, still awaiting a definition. */
  pendingCount: number;
}

export const LibraryContext = createContext<LibraryValue | null>(null);

export function useLibrary(): LibraryValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error('useLibrary must be used inside <LibraryProvider>.');
  return value;
}
