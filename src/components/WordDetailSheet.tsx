import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import type { Word } from '../types';
import { useLibrary } from '../state/LibraryContext';
import { abbreviatePartOfSpeech, formatEntryDate } from '../lib/lexicon';
import { indexOfKeptSense, senseForRecord, synonymsForKeptSense } from '../lib/senses';
import { useCachedLookup } from '../lib/hooks';
import { commit, warn } from '../lib/haptics';
import { refetchMessageFor, type RefetchMessage } from '../lib/refetch';
import { PencilIcon, RefreshIcon, SpeakerIcon, StarIcon, TrashIcon } from './Icons';
import { ReferenceLinks } from './ReferenceLinks';

/**
 * The full record for one word: every sense, the citation, your note, the dates.
 *
 * Read-only by design. Editing lives in WordFormSheet, so this stays a place you
 * can land on from anywhere — a list row, an index entry, a search hit — and see
 * everything without the risk of changing it by accident.
 */

interface WordDetailSheetProps {
  word: Word | null;
  bookTitle?: string;
  onClose: () => void;
  onEdit: (word: Word) => void;
}

export function WordDetailSheet({
  word: opened,
  bookTitle,
  onClose,
  onEdit,
}: WordDetailSheetProps) {
  const { words, updateWord, deleteWord, refetchDefinition } = useLibrary();

  /**
   * Resolve the live record rather than trusting the prop.
   *
   * Callers pass the word they had when the sheet opened, which is a snapshot — so
   * starring, changing the chosen sense, or refetching a definition all updated storage
   * without the sheet ever showing it. Reading through to the library keeps what's on
   * screen honest.
   */
  const word = opened ? (words.find((candidate) => candidate.id === opened.id) ?? opened) : null;
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [refetching, setRefetching] = useState(false);
  const [refetchMessage, setRefetchMessage] = useState<RefetchMessage | null>(null);

  /**
   * The record keeps only the sense you chose, so the full list and the synonyms come
   * from the local cache. Keyed on `updatedAt` so a refetch is picked up. A word pulled
   * from another device has no cache entry here — hence the pointer to refetch.
   */
  const cached = useCachedLookup(word?.term, word?.updatedAt);
  const candidates = cached?.senses ?? [];

  // Never carry an armed delete, or a stale result, over to a different word.
  useEffect(() => {
    setConfirmingDelete(false);
    setRefetchMessage(null);
  }, [opened?.id]);

  if (!word) return null;

  // Offer the cached list where we have it, otherwise just the sense on the record.
  const choices = candidates.length > 0 ? candidates : word.senses;
  const keptIndex = indexOfKeptSense(word, choices);
  const synonyms = synonymsForKeptSense(word, candidates);

  function playAudio(): void {
    if (!word?.audioUrl) return;
    void new Audio(word.audioUrl).play().catch(() => undefined);
  }

  async function refetch(): Promise<void> {
    if (!word || refetching) return;

    setRefetching(true);
    setRefetchMessage(null);
    try {
      const outcome = await refetchDefinition(word.id);
      // Behind an icon with a small result message, so the outcome is easy to miss.
      if (outcome === 'updated') commit();
      else warn();
      // Shared with the capture form, which offers the same retry before a word is
      // saved — and needs the wording to stop promising that the word is safe.
      setRefetchMessage(refetchMessageFor(outcome, { saved: true }));
    } finally {
      setRefetching(false);
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={word.term}
      subtitle={word.phonetic ?? bookTitle}
      footer={
        confirmingDelete ? (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="min-h-11 flex-1 border border-rule px-4 text-sm transition-colors hover:bg-paper-sunk"
            >
              Keep it
            </button>
            <button
              type="button"
              onClick={() => {
                void deleteWord(word.id);
                onClose();
              }}
              className="min-h-11 flex-1 bg-rubric px-4 text-sm text-paper-raised"
            >
              Remove this word
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                // The footer swaps to a confirm pair; a distinct pulse says so.
                warn();
                setConfirmingDelete(true);
              }}
              className="flex min-h-11 w-11 shrink-0 items-center justify-center border border-rule text-ink-faint transition-colors hover:border-rubric hover:text-rubric"
              aria-label={`Remove ${word.term}`}
            >
              <TrashIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onEdit(word)}
              className="flex min-h-11 flex-1 items-center justify-center gap-2 bg-rubric px-4 text-paper-raised"
            >
              <PencilIcon className="h-4 w-4" />
              Edit this entry
            </button>
          </div>
        )
      }
    >
      <div className="space-y-5">
        {/* --- controls ------------------------------------------------- */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              commit();
              void updateWord(word.id, { starred: !word.starred });
            }}
            aria-pressed={word.starred}
            className={`flex min-h-11 items-center gap-2 border px-3 transition-colors ${
              word.starred
                ? 'border-rubric text-rubric'
                : 'border-rule text-ink-faint hover:border-rubric hover:text-rubric'
            }`}
          >
            <StarIcon className="h-4 w-4" filled={word.starred} />
            <span className="label text-current">{word.starred ? 'Starred' : 'Star'}</span>
          </button>

          {word.audioUrl && (
            <button
              type="button"
              onClick={playAudio}
              className="flex min-h-11 items-center gap-2 border border-rule px-3 text-ink-faint transition-colors hover:border-rubric hover:text-rubric"
            >
              <SpeakerIcon className="h-4 w-4" />
              <span className="label text-current">Hear it</span>
            </button>
          )}
        </div>

        {/* --- the citation, first: it's the part only you have --------- */}
        {word.contextSentence ? (
          <figure className="border-l-2 border-rubric/50 pl-3.5">
            <blockquote className="font-text text-[1.0625rem] leading-[1.5] text-ink italic">
              {word.contextSentence}
            </blockquote>
            <figcaption className="label mt-1.5 !normal-case !tracking-normal">
              —{' '}
              {bookTitle && <cite className="font-text not-italic">{bookTitle}</cite>}
              {bookTitle && word.page ? ', ' : ''}
              {word.page && `p. ${word.page}`}
            </figcaption>
          </figure>
        ) : (
          <p className="text-sm text-ink-faint italic">
            No sentence recorded. Add one with Edit — it's the thing you can't
            reconstruct later.
          </p>
        )}

        {word.note && (
          <div>
            <p className="label">Your note</p>
            <p className="mt-1.5 leading-relaxed text-ink-soft">{word.note}</p>
          </div>
        )}

        {/* --- senses --------------------------------------------------- */}
        <div>
          <div className="flex items-start justify-between gap-3">
            <p className="label">
              {choices.length > 1
                ? `${choices.length} senses · tap the one your book meant`
                : 'Definition'}
            </p>

            {/* A capture made on a slow connection can land without its definition.
                This asks again, bypassing the cached answer. */}
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={refetching}
              aria-label={`Fetch the definition of ${word.term} again`}
              title="Fetch the definition again"
              className="-mt-2 -mr-2 flex h-10 w-10 shrink-0 items-center justify-center text-ink-faint transition-colors hover:text-rubric disabled:opacity-40"
            >
              <RefreshIcon className={`h-4 w-4 ${refetching ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {choices.length > 0 ? (
            <ol className="mt-2 space-y-1">
              {choices.map((sense, index) => {
                const isPrimary = index === keptIndex;
                return (
                  <li key={`${sense.partOfSpeech}-${index}`}>
                    <button
                      type="button"
                      // Writes the sense itself, not an index — the record carries the
                      // meaning, so it survives the dictionary reordering its list.
                      onClick={() =>
                        void updateWord(word.id, {
                          senses: [senseForRecord(sense)],
                          primarySense: 0,
                        })
                      }
                      aria-pressed={isPrimary}
                      disabled={choices.length === 1}
                      // Three redundant cues for "this is the sense your book meant": a
                      // solid rule, a genuinely darker surface, and full-strength ink
                      // against faint. Any one of them survives a greyscale display; the
                      // tint alone did not.
                      className={`flex w-full gap-2.5 border-l-2 py-2 pl-2.5 text-left text-[0.9375rem] leading-snug transition-colors ${
                        isPrimary
                          ? 'border-rubric bg-rubric-tint text-ink'
                          : 'border-transparent text-ink-faint hover:border-rule hover:text-ink-soft'
                      }`}
                    >
                      {choices.length > 1 && (
                        <span
                          className={`font-mono text-[0.6875rem] leading-5 ${
                            isPrimary ? 'text-rubric' : ''
                          }`}
                        >
                          {index + 1}
                        </span>
                      )}
                      <span className="flex-1">
                        <span className="pr-1.5 italic">
                          {abbreviatePartOfSpeech(sense.partOfSpeech)}
                        </span>
                        {sense.definition}
                        {sense.example && (
                          <span className="mt-0.5 block text-ink-faint italic">
                            “{sense.example}”
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="mt-1 text-sm text-ink-soft">
              {word.lookupState === 'pending'
                ? "Saved without a definition — it fills in once you're back online, or ask again now."
                : 'No dictionary entry was found for this word.'}
            </p>
          )}

          {/* Synonyms are never stored on a record — they come from the local cache,
              which is why a word pulled from another device has none until refetched. */}
          {synonyms.length > 0 && (
            <p className="mt-3 flex flex-wrap items-baseline gap-x-2">
              <span className="label">Similar</span>
              <span className="text-[0.9375rem] text-ink-soft">{synonyms.join(' · ')}</span>
            </p>
          )}

          {candidates.length === 0 && word.senses.length > 0 && (
            <p className="label mt-3 !normal-case !tracking-normal">
              Other senses and similar words aren't stored with the entry — refresh above to
              fetch them onto this device.
            </p>
          )}

          {refetchMessage && (
            <p
              className={`animate-bleed mt-2.5 border-l-2 pl-3 text-sm ${
                refetchMessage.tone === 'bad'
                  ? 'border-rubric text-ink-soft'
                  : 'border-rule text-ink-soft'
              }`}
            >
              {refetchMessage.text}
            </p>
          )}
        </div>

        <hr className="rule-line" />

        {/* Where to go when the dictionary is thin — which, for literary vocabulary,
            is most of the time. */}
        <div>
          <p className="label">Look it up elsewhere</p>
          <ReferenceLinks term={word.term} compact className="mt-2" />
        </div>

        <hr className="rule-line" />

        {/* The page lives here as well as in the citation, because the citation only
            exists when there is a sentence to attribute — so a page recorded on its own
            was saved and then never shown anywhere. This line always renders. */}
        <p className="label !normal-case !tracking-normal">
          Added {formatEntryDate(word.addedAt)}
          {bookTitle ? ` · ${bookTitle}` : ''}
          {word.page ? ` · p. ${word.page}` : ''}
        </p>
      </div>
    </Sheet>
  );
}
