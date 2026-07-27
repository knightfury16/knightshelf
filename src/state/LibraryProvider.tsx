import { useCallback, useEffect, useMemo, useReducer, type ReactNode } from 'react';
import type { Book, BookStatus, Word } from '../types';
import * as store from '../db/store';
import { newId, nowIso } from '../lib/id';
import { lookupWord } from '../api/dictionary';
import { requestPersistentStorage } from '../lib/persist';
import {
  LibraryContext,
  type LibrarySnapshot,
  type LibraryValue,
  type NewBookInput,
  type NewWordInput,
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

  useEffect(() => {
    let cancelled = false;

    async function load(): Promise<void> {
      try {
        const [books, words] = await Promise.all([store.listBooks(), store.listWords()]);
        if (!cancelled) dispatch({ type: 'loaded', books, words });
      } catch (error: unknown) {
        if (!cancelled) {
          dispatch({
            type: 'failed',
            message: `Local storage is unavailable. ${errorMessage(error)}`,
          });
        }
      }
    }

    void load();

    /**
     * Ask to be exempt from eviction on every start. Chrome decides heuristically
     * and its answer can change as engagement grows (installing the app usually
     * tips it), so a single attempt at first run would be the wrong shape. Silent
     * and non-blocking: a refusal is surfaced in Settings, not thrown here.
     */
    void requestPersistentStorage();

    return () => {
      cancelled = true;
    };
  }, []);

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
    const word: Word = {
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
    };
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
            ? {
                ...word,
                senses: outcome.senses,
                phonetic: outcome.phonetic,
                audioUrl: outcome.audioUrl,
                lookupState: 'resolved',
                updatedAt: nowIso(),
              }
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
      pending.length,
    ],
  );

  return <LibraryContext.Provider value={value}>{children}</LibraryContext.Provider>;
}
