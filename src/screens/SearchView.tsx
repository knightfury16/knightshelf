import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLibrary } from '../state/LibraryContext';
import { WordEntry } from '../components/WordEntry';
import { WordFormSheet } from '../components/WordFormSheet';
import type { Word } from '../types';

/**
 * Search across every book — "where did I learn petrichor?"
 *
 * With no query it falls back to your starred words, so the screen has a purpose
 * before you type anything.
 */

function matches(word: Word, needle: string): boolean {
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

export function SearchView() {
  const { books, words } = useLibrary();
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Word | null>(null);

  const titleById = useMemo(
    () => new Map(books.map((book) => [book.id, book.title])),
    [books],
  );

  const needle = query.trim().toLowerCase();
  const searching = needle.length > 0;

  const results = useMemo(() => {
    const pool = searching
      ? words.filter((word) => matches(word, needle))
      : words.filter((word) => word.starred);
    return [...pool].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  }, [words, needle, searching]);

  /** A word met in more than one book is worth knowing about. */
  const repeated = useMemo(() => {
    if (!searching) return new Map<string, number>();
    const counts = new Map<string, number>();
    for (const word of results) {
      const key = word.term.toLowerCase();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [results, searching]);

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6">
      <header className="pt-8 pb-4 sm:pt-10">
        <h1 className="font-display text-4xl leading-none">Search</h1>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Any word, definition, or sentence…"
          aria-label="Search all words"
          autoComplete="off"
          className="mt-4 min-h-11 w-full border-b border-rule bg-transparent pb-2 font-display text-xl outline-none focus:border-rubric"
        />
        <p className="label mt-3">
          {searching
            ? `${results.length} ${results.length === 1 ? 'match' : 'matches'} across ${books.length} ${books.length === 1 ? 'book' : 'books'}`
            : `${results.length} starred`}
        </p>
      </header>

      <hr className="rule-line" />

      {!searching && results.length === 0 && (
        <div className="animate-rise py-16 text-center">
          <p className="font-display text-2xl text-ink-soft">Nothing starred yet.</p>
          <p className="mx-auto mt-2.5 max-w-xs text-ink-faint">
            Star a word from any book and it will collect here. Or search across everything you've
            looked up.
          </p>
        </div>
      )}

      {searching && results.length === 0 && (
        <p className="label py-16 text-center">No match for “{query.trim()}”.</p>
      )}

      <div className="stagger divide-y divide-rule">
        {results.map((word, index) => {
          const bookTitle = titleById.get(word.bookId);
          const seenTwice = (repeated.get(word.term.toLowerCase()) ?? 0) > 1;
          return (
            <div key={word.id}>
              <div className="flex items-center gap-2 pt-4">
                <Link
                  to={`/book/${word.bookId}`}
                  className="label transition-colors hover:text-rubric"
                >
                  {bookTitle ?? 'Unknown book'}
                </Link>
                {seenTwice && (
                  <span className="label !tracking-normal !normal-case text-rubric">
                    · also in another book
                  </span>
                )}
              </div>
              <WordEntry
                word={word}
                bookTitle={bookTitle}
                index={index}
                onEdit={setEditing}
              />
            </div>
          );
        })}
      </div>

      <WordFormSheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        bookId={editing?.bookId ?? ''}
        word={editing ?? undefined}
      />
    </div>
  );
}
