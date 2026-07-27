import { useMemo, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useLibrary } from '../state/LibraryContext';
import { LookupBar } from '../components/LookupBar';
import { WordEntry } from '../components/WordEntry';
import { WordIndex } from '../components/WordIndex';
import { WordFormSheet } from '../components/WordFormSheet';
import { WordDetailSheet } from '../components/WordDetailSheet';
import { usePersistedState } from '../lib/hooks';
import { crossBookTermIndex } from '../lib/stats';
import { Sheet } from '../components/Sheet';
import { BackIcon } from '../components/Icons';
import type { Word } from '../types';

type SortMode = 'recent' | 'alpha';

/** `entries` = full dictionary entries; `index` = words only, meanings on tap. */
type ViewMode = 'entries' | 'index';

function matches(word: Word, needle: string): boolean {
  if (!needle) return true;
  const haystack = [
    word.term,
    word.note ?? '',
    word.contextSentence ?? '',
    ...word.senses.map((sense) => sense.definition),
  ]
    .join(' ')
    .toLowerCase();
  return haystack.includes(needle);
}

export function BookView() {
  const { bookId } = useParams<{ bookId: string }>();
  const { books, words, status, setBookStatus, deleteBook } = useLibrary();

  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  // Persisted: a preference for the compact index almost certainly applies to
  // every book, not just the one where it got switched on.
  const [view, setView] = usePersistedState<ViewMode>('knightshelf.bookView', 'entries');
  const [editing, setEditing] = useState<Word | null>(null);
  const [detail, setDetail] = useState<Word | null>(null);
  const [managing, setManaging] = useState(false);

  const book = books.find((candidate) => candidate.id === bookId);

  const bookWords = useMemo(
    () => words.filter((word) => word.bookId === bookId),
    [words, bookId],
  );

  const existingTerms = useMemo(
    () => new Set(bookWords.map((word) => word.term.toLowerCase())),
    [bookWords],
  );

  const crossBookMatches = useMemo(
    () => crossBookTermIndex(books, words, bookId ?? ''),
    [books, words, bookId],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const filtered = bookWords.filter((word) => matches(word, needle));
    return filtered.sort((a, b) =>
      sort === 'alpha'
        ? a.term.localeCompare(b.term, undefined, { sensitivity: 'base' })
        : b.addedAt.localeCompare(a.addedAt),
    );
  }, [bookWords, filter, sort]);

  // Still loading from IndexedDB — don't bounce to the shelf prematurely.
  if (status === 'loading') {
    return <p className="label px-4 pt-10">Opening…</p>;
  }

  if (!book) return <Navigate to="/" replace />;

  return (
    <div className="mx-auto max-w-3xl px-4 pb-[calc(9.5rem+env(safe-area-inset-bottom))] sm:px-6">
      <header className="pt-safe">
        <div className="flex items-center justify-between pt-3">
          <Link
            to="/"
            className="-ml-2 flex min-h-11 items-center gap-1 pr-2 text-ink-faint transition-colors hover:text-ink"
          >
            <BackIcon className="h-5 w-5" />
            <span className="label text-current">Shelf</span>
          </Link>

          <button
            type="button"
            onClick={() => setManaging(true)}
            className="-mr-2 flex min-h-11 items-center px-2 text-ink-faint transition-colors hover:text-ink"
          >
            <span className="label text-current">Manage</span>
          </button>
        </div>

        <h1 className="font-display mt-2 text-[2.125rem] leading-[1.08] sm:text-5xl">
          {book.title}
        </h1>
        {book.author && <p className="mt-1.5 text-ink-soft">{book.author}</p>}
        <p className="label mt-2.5">
          {bookWords.length} {bookWords.length === 1 ? 'word' : 'words'} ·{' '}
          {book.status === 'finished' ? 'finished' : 'reading'}
        </p>
      </header>

      <hr className="rule-line mt-5" />

      {bookWords.length > 0 && (
        <>
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter these words…"
            aria-label="Filter words in this book"
            className="min-h-11 w-full bg-transparent text-[0.9375rem] outline-none"
          />

          <hr className="rule-line" />

          {/* Two segmented groups, kept apart so both fit a 412px phone. */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center">
              {(['recent', 'alpha'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSort(mode)}
                  aria-pressed={sort === mode}
                  className={`label min-h-11 pr-2.5 transition-colors ${
                    sort === mode ? 'text-rubric' : 'hover:text-ink-soft'
                  }`}
                >
                  {mode === 'recent' ? 'Recent' : 'A–Z'}
                </button>
              ))}
            </div>

            <div className="flex items-center">
              {(['entries', 'index'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setView(mode)}
                  aria-pressed={view === mode}
                  className={`label min-h-11 pl-2.5 transition-colors ${
                    view === mode ? 'text-rubric' : 'hover:text-ink-soft'
                  }`}
                >
                  {mode === 'entries' ? 'Entries' : 'Index'}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <hr className="rule-line" />

      {bookWords.length === 0 && (
        <div className="animate-rise py-16 text-center">
          <p className="font-display text-2xl leading-snug text-ink-soft">No words yet.</p>
          <p className="mx-auto mt-2.5 max-w-xs text-ink-faint">
            Look one up below. Add the sentence you found it in and the entry will cite this book.
          </p>
        </div>
      )}

      {bookWords.length > 0 && visible.length === 0 && (
        <p className="label py-12 text-center">Nothing matches “{filter.trim()}”.</p>
      )}

      {view === 'index' ? (
        visible.length > 0 && (
          <WordIndex words={visible} onOpen={setDetail} showLetters={sort === 'alpha'} />
        )
      ) : (
        /* Two columns on wide screens, the way a dictionary page actually sets. */
        <div className="stagger divide-y divide-rule md:columns-2 md:gap-10 md:divide-y-0">
          {visible.map((word, index) => (
            <div key={word.id} className="break-inside-avoid md:border-b md:border-rule">
              <WordEntry
                word={word}
                bookTitle={book.title}
                index={index}
                onEdit={setEditing}
                onOpen={setDetail}
              />
            </div>
          ))}
        </div>
      )}

      <LookupBar
        bookId={book.id}
        existingTerms={existingTerms}
        crossBookMatches={crossBookMatches}
        // A book still in progress is one you came here to add to; a finished book
        // is one you came here to re-read.
        autoFocus={book.status === 'reading'}
      />

      {/* Detail is read-only; Edit hands off to the form so only one sheet is ever up. */}
      <WordDetailSheet
        word={detail}
        bookTitle={book.title}
        onClose={() => setDetail(null)}
        onEdit={(word) => {
          setDetail(null);
          setEditing(word);
        }}
      />

      <WordFormSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        bookId={book.id}
        word={editing ?? undefined}
      />

      <Sheet
        open={managing}
        onClose={() => setManaging(false)}
        title={book.title}
        subtitle={book.author}
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => {
              void setBookStatus(book.id, book.status === 'finished' ? 'reading' : 'finished');
              setManaging(false);
            }}
            className="min-h-11 w-full border border-rule px-4 text-left transition-colors hover:bg-paper-sunk"
          >
            {book.status === 'finished' ? 'Move back to reading' : 'Mark as finished'}
          </button>

          <div className="border border-rubric/40 bg-rubric-tint/50 p-3.5">
            <p className="text-sm text-ink-soft">
              Removing this book also removes its {bookWords.length}{' '}
              {bookWords.length === 1 ? 'word' : 'words'}.
            </p>
            <button
              type="button"
              onClick={() => void deleteBook(book.id)}
              className="mt-3 min-h-11 w-full bg-rubric px-4 text-paper-raised"
            >
              Remove book and its words
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
