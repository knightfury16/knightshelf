import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookCover } from '../components/BookCover';
import { AddBookSheet } from '../components/AddBookSheet';
import { Wordmark } from '../components/AppShell';
import { PlusIcon } from '../components/Icons';
import { useLibrary } from '../state/LibraryContext';
import { computeStats } from '../lib/stats';
import type { Book } from '../types';

function countWordsByBook(bookIds: string[], wordBookIds: string[]): Map<string, number> {
  const counts = new Map<string, number>(bookIds.map((id) => [id, 0]));
  for (const bookId of wordBookIds) {
    const current = counts.get(bookId);
    if (current !== undefined) counts.set(bookId, current + 1);
  }
  return counts;
}

/** Books in progress first, then most recently touched. */
function shelfOrder(a: Book, b: Book): number {
  const aReading = a.status === 'reading' ? 0 : 1;
  const bReading = b.status === 'reading' ? 0 : 1;
  if (aReading !== bReading) return aReading - bReading;
  return b.updatedAt.localeCompare(a.updatedAt);
}

export function Shelf() {
  const { books, words, status, error } = useLibrary();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);

  const ordered = useMemo(() => [...books].sort(shelfOrder), [books]);
  const stats = useMemo(() => computeStats(books, words, new Date()), [books, words]);
  const counts = useMemo(
    () =>
      countWordsByBook(
        books.map((book) => book.id),
        words.map((word) => word.bookId),
      ),
    [books, words],
  );

  return (
    <div className="mx-auto max-w-4xl px-4 sm:px-6">
      <header className="pt-8 pb-5 sm:pt-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Wordmark className="text-4xl sm:hidden" />
            <h1 className="font-display hidden text-4xl leading-none sm:block">The Shelf</h1>
            <p className="label mt-2.5">
              {books.length} {books.length === 1 ? 'book' : 'books'} · {words.length}{' '}
              {words.length === 1 ? 'word' : 'words'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setAdding(true)}
            className="flex min-h-11 items-center gap-1.5 border border-rule px-3 transition-colors hover:border-rubric hover:text-rubric"
          >
            <PlusIcon className="h-4 w-4" />
            <span className="label text-current">Book</span>
          </button>
        </div>
      </header>

      <hr className="rule-line" />

      {status === 'error' && (
        <p className="mt-8 border-l-2 border-rubric bg-rubric-tint px-4 py-3 text-sm">{error}</p>
      )}

      {status === 'loading' && <p className="label py-10">Opening the shelf…</p>}

      {/* A colophon, not a dashboard: three figures and one line of prose. */}
      {stats.totalWords > 0 && (
        <section className="animate-rise py-5" aria-label="Reading statistics">
          <div className="grid grid-cols-3 gap-3">
            {[
              { figure: stats.totalWords, label: 'Words kept' },
              { figure: stats.wordsThisWeek, label: 'This week' },
              { figure: stats.booksFinished, label: 'Finished' },
            ].map(({ figure, label }) => (
              <div key={label}>
                <p className="font-display text-3xl leading-none">{figure}</p>
                <p className="label mt-1.5">{label}</p>
              </div>
            ))}
          </div>

          {stats.richest && (
            <p className="mt-4 text-sm text-ink-soft">
              Most from <span className="font-text italic">{stats.richest.title}</span> —{' '}
              {stats.richest.count} {stats.richest.count === 1 ? 'word' : 'words'}.
            </p>
          )}
        </section>
      )}

      {stats.totalWords > 0 && <hr className="rule-line" />}

      {status === 'ready' && ordered.length === 0 && (
        <div className="animate-rise py-16 text-center sm:py-24">
          <p className="font-display text-3xl leading-snug text-ink-soft">
            Nothing on the shelf yet.
          </p>
          <p className="mx-auto mt-3 max-w-sm text-ink-faint">
            Add the book you're reading now. Every word you look up will file itself underneath it.
          </p>
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="mt-7 inline-flex min-h-11 items-center gap-2 bg-rubric px-5 text-paper-raised"
          >
            <PlusIcon className="h-4 w-4" />
            Add your first book
          </button>
        </div>
      )}

      {ordered.length > 0 && (
        <div className="stagger grid grid-cols-2 gap-x-4 sm:grid-cols-3 sm:gap-x-5 md:grid-cols-4 lg:grid-cols-5">
          {ordered.map((book, index) => (
            <Link
              key={book.id}
              to={`/book/${book.id}`}
              style={{ '--i': index } as React.CSSProperties}
              className="group flex flex-col focus-visible:outline-offset-4"
            >
              {/* Covers bottom-align in a stretched cell, so uneven heights all
                  stand on one continuous shelf line across the row. */}
              <div className="flex flex-1 items-end px-0.5 pt-7">
                <BookCover
                  id={book.id}
                  title={book.title}
                  author={book.author}
                  coverUrl={book.coverUrl}
                  className={`transition-transform duration-200 group-hover:-translate-y-1.5 group-active:-translate-y-1 ${
                    book.status === 'finished' ? 'opacity-80' : ''
                  }`}
                />
              </div>

              <div className="shelf-rule h-[3px]" aria-hidden />

              <div className="pt-2.5 pb-8">
                <p className="font-display text-[1.0625rem] leading-[1.2] transition-colors group-hover:text-rubric">
                  {book.title}
                </p>
                {book.author && (
                  <p className="mt-0.5 truncate text-sm text-ink-faint">{book.author}</p>
                )}
                <p className="label mt-1.5">
                  {counts.get(book.id) ?? 0} {(counts.get(book.id) ?? 0) === 1 ? 'word' : 'words'}
                  {book.status === 'finished' ? ' · finished' : ''}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}

      <AddBookSheet
        open={adding}
        onClose={() => setAdding(false)}
        onAdded={(bookId) => navigate(`/book/${bookId}`)}
      />
    </div>
  );
}
