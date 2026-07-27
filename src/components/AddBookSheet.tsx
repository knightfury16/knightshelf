import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { searchBooks, type BookSearchResult } from '../api/openlibrary';
import { useDebounced } from '../lib/hooks';
import { useLibrary, type NewBookInput } from '../state/LibraryContext';

/**
 * Add a book by title via Open Library, with manual entry always available —
 * for editions it doesn't know, or for adding a book with no connection.
 */

interface AddBookSheetProps {
  open: boolean;
  onClose: () => void;
  onAdded: (bookId: string) => void;
}

export function AddBookSheet({ open, onClose, onAdded }: AddBookSheetProps) {
  const { createBook } = useLibrary();

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<BookSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [manual, setManual] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualAuthor, setManualAuthor] = useState('');
  const [saving, setSaving] = useState(false);

  const debouncedQuery = useDebounced(query, 350);

  // Reset between openings so the sheet never shows a previous session's results.
  useEffect(() => {
    if (open) return;
    setQuery('');
    setResults([]);
    setSearching(false);
    setSearchFailed(false);
    setManual(false);
    setManualTitle('');
    setManualAuthor('');
  }, [open]);

  useEffect(() => {
    const term = debouncedQuery.trim();
    if (!open || manual || term.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchFailed(false);
      return;
    }

    const controller = new AbortController();
    setSearching(true);
    setSearchFailed(false);

    void searchBooks(term, controller.signal).then((outcome) => {
      if (controller.signal.aborted) return;
      setSearching(false);
      if (outcome.status === 'ok') setResults(outcome.results);
      else setSearchFailed(true);
    });

    // Supersede in-flight requests rather than racing them.
    return () => controller.abort();
  }, [debouncedQuery, open, manual]);

  async function add(input: NewBookInput): Promise<void> {
    if (saving) return;
    setSaving(true);
    try {
      const book = await createBook(input);
      onAdded(book.id);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const canSaveManual = manualTitle.trim().length > 0 && !saving;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a book"
      subtitle={manual ? 'Enter the details yourself' : 'Search by title'}
      footer={
        manual ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setManual(false)}
              className="min-h-11 flex-1 border border-rule px-4 text-sm transition-colors hover:bg-paper-sunk"
            >
              Back to search
            </button>
            <button
              type="button"
              disabled={!canSaveManual}
              onClick={() => void add({ title: manualTitle, author: manualAuthor })}
              className="min-h-11 flex-1 bg-rubric px-4 text-sm text-paper-raised transition-opacity disabled:opacity-40"
            >
              {saving ? 'Adding…' : 'Add to shelf'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => {
              setManual(true);
              setManualTitle(query.trim());
            }}
            className="min-h-11 w-full border border-rule px-4 text-sm transition-colors hover:bg-paper-sunk"
          >
            Can't find it? Add manually
          </button>
        )
      }
    >
      {manual ? (
        <div className="space-y-4">
          <label className="block">
            <span className="label">Title</span>
            <input
              value={manualTitle}
              onChange={(event) => setManualTitle(event.target.value)}
              placeholder="Blood Meridian"
              className="mt-1.5 min-h-11 w-full border-b border-rule bg-transparent pb-1.5 font-display text-xl outline-none focus:border-rubric"
            />
          </label>
          <label className="block">
            <span className="label">Author</span>
            <input
              value={manualAuthor}
              onChange={(event) => setManualAuthor(event.target.value)}
              placeholder="Cormac McCarthy"
              className="mt-1.5 min-h-11 w-full border-b border-rule bg-transparent pb-1.5 outline-none focus:border-rubric"
            />
          </label>
        </div>
      ) : (
        <div>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Title, or title and author"
            autoComplete="off"
            className="min-h-11 w-full border-b border-rule bg-transparent pb-2 font-display text-xl outline-none focus:border-rubric"
          />

          <div className="mt-4 min-h-24">
            {searching && <p className="label py-3">Searching…</p>}

            {searchFailed && !searching && (
              <p className="py-3 text-sm text-ink-soft">
                Couldn't reach Open Library. You can still add the book manually.
              </p>
            )}

            {!searching && !searchFailed && debouncedQuery.trim().length >= 2 && results.length === 0 && (
              <p className="py-3 text-sm text-ink-soft">No matches. Try adding it manually.</p>
            )}

            <ul className="stagger divide-y divide-rule">
              {results.map((result, index) => (
                <li key={result.key} style={{ '--i': index } as React.CSSProperties}>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void add({
                        title: result.title,
                        author: result.author,
                        coverUrl: result.coverUrl,
                      })
                    }
                    className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-paper-sunk disabled:opacity-50"
                  >
                    <div className="h-16 w-11 shrink-0 overflow-hidden rounded-[2px] bg-paper-sunk shadow-book">
                      {result.coverUrl && (
                        <img
                          src={result.coverUrl}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-display truncate text-lg leading-snug">{result.title}</p>
                      <p className="truncate text-sm text-ink-faint">
                        {result.author ?? 'Unknown author'}
                        {result.year ? ` · ${result.year}` : ''}
                      </p>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Sheet>
  );
}
