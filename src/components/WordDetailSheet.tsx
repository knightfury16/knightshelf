import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import type { Word } from '../types';
import { useLibrary } from '../state/LibraryContext';
import { abbreviatePartOfSpeech, formatEntryDate } from '../lib/lexicon';
import { PencilIcon, SpeakerIcon, StarIcon, TrashIcon } from './Icons';
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

export function WordDetailSheet({ word, bookTitle, onClose, onEdit }: WordDetailSheetProps) {
  const { updateWord, deleteWord } = useLibrary();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Never carry an armed delete over to a different word.
  useEffect(() => {
    setConfirmingDelete(false);
  }, [word?.id]);

  if (!word) return null;

  const senses = word.senses;

  function playAudio(): void {
    if (!word?.audioUrl) return;
    void new Audio(word.audioUrl).play().catch(() => undefined);
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
              onClick={() => setConfirmingDelete(true)}
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
            onClick={() => void updateWord(word.id, { starred: !word.starred })}
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
        {senses.length > 0 ? (
          <div>
            <p className="label">
              {senses.length === 1
                ? 'Definition'
                : `${senses.length} senses · tap the one your book meant`}
            </p>
            <ol className="mt-2 space-y-1">
              {senses.map((sense, index) => {
                const isPrimary = index === word.primarySense;
                return (
                  <li key={`${sense.partOfSpeech}-${index}`}>
                    <button
                      type="button"
                      onClick={() => void updateWord(word.id, { primarySense: index })}
                      aria-pressed={isPrimary}
                      disabled={senses.length === 1}
                      className={`flex w-full gap-2.5 border-l-2 py-2 pl-2.5 text-left text-[0.9375rem] leading-snug transition-colors ${
                        isPrimary
                          ? 'border-rubric bg-rubric-tint/60 text-ink'
                          : 'border-transparent text-ink-faint hover:border-rule hover:text-ink-soft'
                      }`}
                    >
                      {senses.length > 1 && (
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
          </div>
        ) : (
          <p className="text-sm text-ink-soft">
            {word.lookupState === 'pending'
              ? "Saved offline — the definition will fill in once you're back online."
              : 'No dictionary entry was found for this word.'}
          </p>
        )}

        <hr className="rule-line" />

        {/* Where to go when the dictionary is thin — which, for literary vocabulary,
            is most of the time. */}
        <div>
          <p className="label">Look it up elsewhere</p>
          <ReferenceLinks term={word.term} compact className="mt-2" />
        </div>

        <hr className="rule-line" />

        <p className="label !normal-case !tracking-normal">
          Added {formatEntryDate(word.addedAt)}
          {bookTitle ? ` · ${bookTitle}` : ''}
        </p>
      </div>
    </Sheet>
  );
}
