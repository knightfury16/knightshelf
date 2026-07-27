import type { Book, Word } from '../types';

/**
 * Derived reads over the library. Pure functions, `now` passed in rather than
 * read from the clock, so behaviour is predictable and testable.
 */

function laterIso(a: string, b?: string): string {
  if (!b) return a;
  return a.localeCompare(b) >= 0 ? a : b;
}

/**
 * The book to open on launch.
 *
 * Recency counts word captures, not just edits to the book record — adding a word
 * doesn't touch `book.updatedAt`, but it's the strongest possible signal that this
 * is the book in your hands right now. Finished books are never chosen.
 */
export function currentlyReadingBook(books: Book[], words: Word[]): Book | undefined {
  const reading = books.filter((book) => book.status === 'reading');
  if (reading.length === 0) return undefined;

  const lastCapture = new Map<string, string>();
  for (const word of words) {
    const previous = lastCapture.get(word.bookId);
    if (!previous || word.addedAt.localeCompare(previous) > 0) {
      lastCapture.set(word.bookId, word.addedAt);
    }
  }

  return [...reading].sort((a, b) =>
    laterIso(b.updatedAt, lastCapture.get(b.id)).localeCompare(
      laterIso(a.updatedAt, lastCapture.get(a.id)),
    ),
  )[0];
}

export interface LibraryStats {
  totalWords: number;
  wordsThisWeek: number;
  booksFinished: number;
  richest?: { title: string; count: number };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function computeStats(books: Book[], words: Word[], now: Date): LibraryStats {
  const cutoff = new Date(now.getTime() - WEEK_MS).toISOString();

  const perBook = new Map<string, number>();
  let wordsThisWeek = 0;

  for (const word of words) {
    perBook.set(word.bookId, (perBook.get(word.bookId) ?? 0) + 1);
    if (word.addedAt.localeCompare(cutoff) > 0) wordsThisWeek += 1;
  }

  let richest: LibraryStats['richest'];
  for (const book of books) {
    const count = perBook.get(book.id) ?? 0;
    if (count > 0 && (!richest || count > richest.count)) {
      richest = { title: book.title, count };
    }
  }

  return {
    totalWords: words.length,
    wordsThisWeek,
    booksFinished: books.filter((book) => book.status === 'finished').length,
    richest,
  };
}

/**
 * Maps each lowercased term to the books it appears in, excluding one.
 *
 * Powers the cross-book notice: meeting a word again in a different book is a real
 * signal about your own reading, and worth surfacing at the moment you save it.
 */
export function crossBookTermIndex(
  books: Book[],
  words: Word[],
  excludeBookId: string,
): Map<string, string[]> {
  const titles = new Map(books.map((book) => [book.id, book.title]));
  const index = new Map<string, string[]>();

  for (const word of words) {
    if (word.bookId === excludeBookId) continue;
    const title = titles.get(word.bookId);
    if (!title) continue;

    const key = word.term.toLowerCase();
    const existing = index.get(key);
    if (existing) {
      if (!existing.includes(title)) existing.push(title);
    } else {
      index.set(key, [title]);
    }
  }

  return index;
}
