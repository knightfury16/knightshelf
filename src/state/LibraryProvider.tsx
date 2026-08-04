import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { Book, BookStatus, Word } from '../types';
import { indexOfKeptSense, trimWord } from '../lib/senses';
import * as store from '../db/store';
import { newId, nowIso } from '../lib/id';
import { lookupWord } from '../api/dictionary';
import { requestPersistentStorage } from '../lib/persist';
import { deleteRetiredCaches } from '../lib/cleanup';
import {
  LibraryContext,
  type LibrarySnapshot,
  type LibraryValue,
  type NewBookInput,
  type NewWordInput,
  type RefetchOutcome,
} from './LibraryContext';

/**
 * The whole library lives in memory — a few thousand words is trivial — with
 * IndexedDB written through on every mutation. All updates are immutable so React
 * sees real identity changes and nothing mutates shared state underfoot.
 */

type Action =
  | { type: 'loaded'; books: Book[]; words: Word[] }
  | { type: 'failed'; message: string }
  | { type: 'bookUpserted'; book: Book }
  | { type: 'bookRemoved'; id: string }
  | { type: 'wordUpserted'; word: Word }
  | { type: 'wordsUpserted'; words: Word[] }
  | { type: 'wordRemoved'; id: string };

function upsert<T extends { id: string }>(items: T[], next: T): T[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index === -1) return [...items, next];
  return [...items.slice(0, index), next, ...items.slice(index + 1)];
}

function reducer(state: LibrarySnapshot, action: Action): LibrarySnapshot {
  switch (action.type) {
    case 'loaded':
      return { ...state, status: 'ready', books: action.books, words: action.words };
    case 'failed':
      return { ...state, status: 'error', error: action.message };
    case 'bookUpserted':
      return { ...state, books: upsert(state.books, action.book) };
    case 'bookRemoved':
      return {
        ...state,
        books: state.books.filter((book) => book.id !== action.id),
        words: state.words.filter((word) => word.bookId !== action.id),
      };
    case 'wordUpserted':
      return { ...state, words: upsert(state.words, action.word) };
    case 'wordsUpserted':
      return {
        ...state,
        words: action.words.reduce((acc, word) => upsert(acc, word), state.words),
      };
    case 'wordRemoved':
      return { ...state, words: state.words.filter((word) => word.id !== action.id) };
    default:
      return state;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}


export function LibraryProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    books: [],
    words: [],
    status: 'loading',
  } satisfies LibrarySnapshot);

  const reload = useCallback(async (): Promise<void> => {
    try {
      /**
       * Moves any full sense list into the local cache and trims the record. Idempotent
       * and cheap once done, and it must complete before the first sync — otherwise a
       * merge could trim a record here before its senses had been preserved.
       */
      await store.trimStoredSenses();

      const [books, words] = await Promise.all([store.listBooks(), store.listWords()]);
      dispatch({ type: 'loaded', books, words });
    } catch (error: unknown) {
      dispatch({
        type: 'failed',
        message: `Local storage is unavailable. ${errorMessage(error)}`,
      });
    }
  }, []);

  useEffect(() => {
    void reload();

    /**
     * Ask to be exempt from eviction on every start. Chrome decides heuristically
     * and its answer can change as engagement grows (installing the app usually
     * tips it), so a single attempt at first run would be the wrong shape. Silent
     * and non-blocking: a refusal is surfaced in Settings, not thrown here.
     */
    void requestPersistentStorage();

    // Reclaims space on installs that still hold caches we no longer write to.
    void deleteRetiredCaches();
  }, [reload]);

  const createBook = useCallback(async (input: NewBookInput): Promise<Book> => {
    const stamp = nowIso();
    const book: Book = {
      id: newId(),
      title: input.title.trim(),
      author: input.author?.trim() || undefined,
      coverUrl: input.coverUrl,
      isbn: input.isbn?.trim() || undefined,
      status: 'reading',
      createdAt: stamp,
      updatedAt: stamp,
    };
    await store.putBook(book);
    dispatch({ type: 'bookUpserted', book });
    return book;
  }, []);

  const updateBook = useCallback(
    async (id: string, patch: Partial<Omit<Book, 'id'>>): Promise<void> => {
      const existing = await store.getBook(id);
      if (!existing) return;
      const book: Book = { ...existing, ...patch, updatedAt: nowIso() };
      await store.putBook(book);
      dispatch({ type: 'bookUpserted', book });
    },
    [],
  );

  const setBookStatus = useCallback(
    async (id: string, status: BookStatus): Promise<void> => {
      await updateBook(id, {
        status,
        finishedAt: status === 'finished' ? nowIso() : undefined,
      });
    },
    [updateBook],
  );

  const deleteBook = useCallback(async (id: string): Promise<void> => {
    await store.softDeleteBook(id);
    dispatch({ type: 'bookRemoved', id });
  }, []);

  const saveWord = useCallback(async (input: NewWordInput): Promise<Word> => {
    const stamp = nowIso();
    // Only the chosen sense is stored; the full list stays in the local lookup cache.
    const word: Word = trimWord({
      id: newId(),
      bookId: input.bookId,
      term: input.term.trim(),
      senses: input.senses,
      primarySense: input.primarySense,
      phonetic: input.phonetic,
      audioUrl: input.audioUrl,
      contextSentence: input.contextSentence?.trim() || undefined,
      page: input.page?.trim() || undefined,
      note: input.note?.trim() || undefined,
      starred: false,
      lookupState: input.lookupState,
      addedAt: stamp,
      updatedAt: stamp,
    });
    await store.putWord(word);
    dispatch({ type: 'wordUpserted', word });
    return word;
  }, []);

  const updateWord = useCallback(
    async (id: string, patch: Partial<Omit<Word, 'id' | 'bookId'>>): Promise<void> => {
      const existing = await store.getWord(id);
      if (!existing) return;
      const word: Word = { ...existing, ...patch, updatedAt: nowIso() };
      await store.putWord(word);
      dispatch({ type: 'wordUpserted', word });
    },
    [],
  );

  const deleteWord = useCallback(async (id: string): Promise<void> => {
    await store.softDeleteWord(id);
    dispatch({ type: 'wordRemoved', id });
  }, []);

  /**
   * Asks the dictionary again for a word already saved.
   *
   * A capture made on a slow connection is stored as `pending` and normally resolves
   * itself when the network returns — this is the manual lever for when it hasn't, or
   * when a `notfound` was really a transient failure. Bypasses the cache, since the
   * remembered answer is exactly what we're trying to get past.
   *
   * On failure the record is left completely alone: a refetch must never be able to
   * destroy a definition you already had.
   */
  const refetchDefinition = useCallback(async (id: string): Promise<RefetchOutcome> => {
    const existing = await store.getWord(id);
    if (!existing) return 'missing';

    const outcome = await lookupWord(existing.term, { force: true });
    if (outcome.status === 'unavailable') return 'unavailable';

    if (outcome.status === 'notfound') {
      // Record the miss, but keep any senses already held rather than wiping them.
      const next: Word = { ...existing, lookupState: 'notfound', updatedAt: nowIso() };
      await store.putWord(next);
      dispatch({ type: 'wordUpserted', word: next });
      return 'notfound';
    }

    /**
     * Keep the same meaning where the dictionary still has it. Matched on the
     * definition text, since a refetch can reorder the list and an index would
     * silently start pointing at something else.
     */
    const kept = Math.max(0, indexOfKeptSense(existing, outcome.senses));

    const next: Word = trimWord({
      ...existing,
      senses: outcome.senses,
      phonetic: outcome.phonetic,
      audioUrl: outcome.audioUrl,
      primarySense: kept,
      lookupState: 'resolved',
      updatedAt: nowIso(),
    });
    await store.putWord(next);
    dispatch({ type: 'wordUpserted', word: next });
    return 'updated';
  }, []);

  const pending = useMemo(
    () => state.words.filter((word) => word.lookupState === 'pending'),
    [state.words],
  );

  /**
   * Words captured offline get their definitions filled in once there's a
   * connection again, so a dead signal never costs you a word.
   */
  useEffect(() => {
    if (pending.length === 0) return;

    let cancelled = false;

    async function resolvePending(): Promise<void> {
      if (!navigator.onLine) return;

      const resolved: Word[] = [];
      for (const word of pending) {
        const outcome = await lookupWord(word.term);
        if (outcome.status === 'unavailable') break; // Still offline; try again later.

        const next: Word =
          outcome.status === 'found'
            ? trimWord({
                ...word,
                senses: outcome.senses,
                primarySense: 0,
                phonetic: outcome.phonetic,
                audioUrl: outcome.audioUrl,
                lookupState: 'resolved',
                updatedAt: nowIso(),
              })
            : { ...word, lookupState: 'notfound', updatedAt: nowIso() };

        await store.putWord(next);
        resolved.push(next);
      }

      if (!cancelled && resolved.length > 0) {
        dispatch({ type: 'wordsUpserted', words: resolved });
      }
    }

    void resolvePending();
    window.addEventListener('online', resolvePending);
    return () => {
      cancelled = true;
      window.removeEventListener('online', resolvePending);
    };
  }, [pending]);

  const value = useMemo<LibraryValue>(
    () => ({
      ...state,
      createBook,
      updateBook,
      setBookStatus,
      deleteBook,
      saveWord,
      updateWord,
      deleteWord,
      refetchDefinition,
      reload,
      pendingCount: pending.length,
    }),
    [
      state,
      createBook,
      updateBook,
      setBookStatus,
      deleteBook,
      saveWord,
      updateWord,
      deleteWord,
      refetchDefinition,
      reload,
      pending.length,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
