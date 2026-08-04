import { useEffect, useRef, useState } from 'react';
import { lookupWord } from '../api/dictionary';
import { useDebounced, useOnline } from '../lib/hooks';
import { useLibrary } from '../state/LibraryContext';
import { abbreviatePartOfSpeech } from '../lib/lexicon';
import type { LookupState, Sense } from '../types';
import { WordFormSheet, type WordDraft } from './WordFormSheet';
import { commit } from '../lib/haptics';
import { SpeakerIcon } from './Icons';
import { ReferenceLinks } from './ReferenceLinks';

/**
 * The capture bar — the most-used surface in the app, so it gets the bottom edge
 * of the screen where your thumb already is.
 *
 * Fast path is two actions: type the word, tap Save. "Detail" opens the full form
 * for picking a sense or recording the sentence. A word is *always* saveable —
 * offline, or missing from the dictionary entirely — because losing the word is
 * the only genuinely bad outcome here.
 */

type Preview =
  | { state: 'idle' }
  | { state: 'looking' }
  | { state: 'found'; senses: Sense[]; phonetic?: string; audioUrl?: string }
  | { state: 'notfound' }
  | { state: 'offline' };

interface LookupBarProps {
  bookId: string;
  /** Lowercased terms already filed under this book, for the duplicate hint. */
  existingTerms: Set<string>;
  /** Lowercased term -> titles of *other* books holding it. */
  crossBookMatches: Map<string, string[]>;
  /**
   * Focus the field on mount. True for a book you're still reading — you opened it
   * to look something up — and false for finished books, which you visit to review.
   */
  autoFocus?: boolean;
}

export function LookupBar({
  bookId,
  existingTerms,
  crossBookMatches,
  autoFocus = false,
}: LookupBarProps) {
  const { saveWord } = useLibrary();
  const online = useOnline();
  const inputRef = useRef<HTMLInputElement>(null);

  const [term, setTerm] = useState('');
  const [preview, setPreview] = useState<Preview>({ state: 'idle' });
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const debounced = useDebounced(term, 450);
  const latestTerm = useRef('');

  /**
   * Note: Chrome on Android only raises Gboard for a programmatic focus that sits
   * within a user-gesture chain. Arriving by tapping a book on the shelf qualifies;
   * a cold app launch does not, so there the caret lands but the keyboard may wait
   * for one tap.
   */
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    const query = debounced.trim();
    latestTerm.current = query;

    if (query.length < 2) {
      setPreview({ state: 'idle' });
      return;
    }

    setPreview({ state: 'looking' });
    let cancelled = false;

    void lookupWord(query).then((outcome) => {
      // Ignore results for a word the user has already typed past.
      if (cancelled || latestTerm.current !== query) return;

      if (outcome.status === 'found') {
        setPreview({
          state: 'found',
          senses: outcome.senses,
          phonetic: outcome.phonetic,
          audioUrl: outcome.audioUrl,
        });
      } else if (outcome.status === 'notfound') {
        setPreview({ state: 'notfound' });
      } else {
        setPreview({ state: 'offline' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [debounced]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(timer);
  }, [flash]);

  const trimmed = term.trim();
  const isDuplicate = trimmed.length > 0 && existingTerms.has(trimmed.toLowerCase());
  const otherBooks = trimmed.length > 0 ? crossBookMatches.get(trimmed.toLowerCase()) : undefined;
  const canSave = trimmed.length > 0 && preview.state !== 'looking' && !saving;

  function lookupStateFor(current: Preview): LookupState {
    if (current.state === 'found') return 'resolved';
    if (current.state === 'offline') return 'pending';
    return 'notfound';
  }

  function draftFor(current: Preview): WordDraft {
    return {
      term: trimmed,
      senses: current.state === 'found' ? current.senses : [],
      lookupState: lookupStateFor(current),
      phonetic: current.state === 'found' ? current.phonetic : undefined,
      audioUrl: current.state === 'found' ? current.audioUrl : undefined,
    };
  }

  async function quickSave(): Promise<void> {
    if (!canSave) return;
    setSaving(true);
    try {
      const draft = draftFor(preview);
      await saveWord({
        bookId,
        term: draft.term,
        senses: draft.senses,
        primarySense: 0,
        lookupState: draft.lookupState,
        phonetic: draft.phonetic,
        audioUrl: draft.audioUrl,
      });
      // The field clears itself, which looks the same as a press that missed.
      commit();
      setFlash(draft.term);
      setTerm('');
      setPreview({ state: 'idle' });
    } finally {
      setSaving(false);
    }
  }

  const primary = preview.state === 'found' ? preview.senses[0] : undefined;

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper-raised/97 px-safe backdrop-blur">
        <div className="mx-auto max-w-3xl px-4">
          {/* ---- preview, above the input so the input stays by the thumb ---- */}

          {preview.state !== 'idle' && (
            <div className="animate-rise max-h-[28dvh] overflow-y-auto overscroll-contain pt-3">
              {preview.state === 'looking' && <p className="label pb-1">Looking up…</p>}

              {preview.state === 'found' && primary && (
                <div className="pb-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-display text-xl leading-none">{trimmed}</span>
                    {preview.phonetic && (
                      <span className="font-mono text-[0.6875rem] text-ink-faint">
                        {preview.phonetic}
                      </span>
                    )}
                    {preview.audioUrl && (
                      <button
                        type="button"
                        aria-label={`Hear ${trimmed}`}
                        onClick={() =>
                          void new Audio(preview.audioUrl).play().catch(() => undefined)
                        }
                        className="text-ink-faint transition-colors hover:text-rubric"
                      >
                        <SpeakerIcon className="h-4 w-4" />
                      </button>
                    )}
                    {preview.senses.length > 1 && (
                      <span className="label ml-auto">{preview.senses.length} senses</span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-3 text-[0.9375rem] leading-snug text-ink-soft">
                    <span className="pr-1.5 text-ink-faint italic">
                      {abbreviatePartOfSpeech(primary.partOfSpeech)}
                    </span>
                    {primary.definition}
                  </p>

                  {primary.example && (
                    <p className="mt-1 line-clamp-2 text-[0.875rem] leading-snug text-ink-faint italic">
                      “{primary.example}”
                    </p>
                  )}
                </div>
              )}

              {preview.state === 'notfound' && (
                <div className="pb-1">
                  <p className="text-sm text-ink-soft">
                    No dictionary entry for <span className="italic">{trimmed}</span>. Save it
                    anyway and write your own meaning — or look it up elsewhere.
                  </p>
                  {/* Turns a dead end into a doorway — and files the word before
                      leaving, so checking it elsewhere cannot cost you the capture. */}
                  <ReferenceLinks
                    term={trimmed}
                    label="Save & look up"
                    beforeNavigate={quickSave}
                    className="mt-1.5"
                  />
                </div>
              )}

              {preview.state === 'offline' && (
                <p className="pb-1 text-sm text-ink-soft">
                  {online ? "Dictionary didn't respond." : "You're offline."} Save it now — the
                  definition fills in later.
                </p>
              )}

              {isDuplicate && (
                <p className="label pt-1 !normal-case !tracking-normal text-rubric">
                  Already filed under this book.
                </p>
              )}

              {otherBooks && (
                <p className="label pt-1 !normal-case !tracking-normal text-ink-soft">
                  You also met this in{' '}
                  <span className="font-text italic">{otherBooks.join(', ')}</span>.
                </p>
              )}
            </div>
          )}

          {flash && (
            <p className="animate-bleed label pt-3 !normal-case !tracking-normal text-rubric">
              “{flash}” added to this book.
            </p>
          )}

          {/* ---- the input row ---- */}

          <div className="flex items-center gap-2 py-3">
            <input
              ref={inputRef}
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void quickSave();
              }}
              placeholder="Look up a word…"
              aria-label="Look up a word"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="done"
              className="min-h-11 flex-1 border-b border-rule bg-transparent pb-1.5 font-display text-xl outline-none focus:border-rubric"
            />

            {trimmed.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setDetailOpen(true)}
                  disabled={preview.state === 'looking'}
                  className="min-h-11 shrink-0 border border-rule px-3 transition-colors hover:border-rubric hover:text-rubric disabled:opacity-40"
                >
                  <span className="label text-current">Detail</span>
                </button>
                <button
                  type="button"
                  onClick={() => void quickSave()}
                  disabled={!canSave}
                  className="min-h-11 shrink-0 bg-rubric px-4 text-paper-raised transition-opacity disabled:opacity-40"
                >
                  <span className="label !text-[0.6875rem] text-current">
                    {saving ? 'Saving' : 'Save'}
                  </span>
                </button>
              </>
            )}
          </div>
        </div>
        <div className="pb-safe" />
      </div>

      <WordFormSheet
        open={detailOpen}
        onClose={() => {
          setDetailOpen(false);
          setTerm('');
          setPreview({ state: 'idle' });
        }}
        bookId={bookId}
        draft={draftFor(preview)}
      />
    </>
  );
}
