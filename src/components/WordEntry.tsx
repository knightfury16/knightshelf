import { useState } from 'react';
import type { Word } from '../types';
import { useLibrary } from '../state/LibraryContext';
import { abbreviatePartOfSpeech, formatEntryDate } from '../lib/lexicon';
import { commit, warn } from '../lib/haptics';
import { PencilIcon, SpeakerIcon, StarIcon, TrashIcon } from './Icons';

/**
 * A word, set as a dictionary entry.
 *
 * The sentence from your book is presented as an attributed citation — which is
 * precisely what it is. The OED cites literature to illustrate each sense; here
 * the citation is the book where you actually met the word.
 */

interface WordEntryProps {
  word: Word;
  /** Shown in the citation. Passed explicitly so global search can attribute across books. */
  bookTitle?: string;
  onEdit: (word: Word) => void;
  /** Tapping the headword opens the full record. */
  onOpen: (word: Word) => void;
  index?: number;
}

export function WordEntry({ word, bookTitle, onEdit, onOpen, index = 0 }: WordEntryProps) {
  const { updateWord, deleteWord } = useLibrary();
  const [expanded, setExpanded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const primary = word.senses[word.primarySense] ?? word.senses[0];
  const extraSenses = Math.max(0, word.senses.length - 1);

  function playAudio(): void {
    if (!word.audioUrl) return;
    // Autoplay policy or a dead CDN link — nothing worth interrupting the user for.
    void new Audio(word.audioUrl).play().catch(() => undefined);
  }

  return (
    <article
      style={{ '--i': index } as React.CSSProperties}
      className="group py-5 first:pt-4"
    >
      <div className="flex items-baseline gap-x-2.5 gap-y-1">
        <h3 className="font-display text-[1.75rem] leading-none">
          <button
            type="button"
            onClick={() => onOpen(word)}
            className="text-left transition-colors hover:text-rubric"
          >
            {word.term}
          </button>
        </h3>

        {word.phonetic && (
          <span className="font-mono text-xs text-ink-faint">{word.phonetic}</span>
        )}

        {word.audioUrl && (
          <button
            type="button"
            onClick={playAudio}
            aria-label={`Hear ${word.term}`}
            className="flex h-8 w-8 items-center justify-center text-ink-faint transition-colors hover:text-rubric"
          >
            <SpeakerIcon className="h-4 w-4" />
          </button>
        )}

        <div className="flex-1" />

        <button
          type="button"
          onClick={() => {
            commit();
            void updateWord(word.id, { starred: !word.starred });
          }}
          aria-label={word.starred ? `Unstar ${word.term}` : `Star ${word.term}`}
          aria-pressed={word.starred}
          className={`flex h-10 w-10 items-center justify-center transition-colors ${
            word.starred ? 'text-rubric' : 'text-ink-faint hover:text-rubric'
          }`}
        >
          <StarIcon className="h-[1.15rem] w-[1.15rem]" filled={word.starred} />
        </button>
      </div>

      {/* --- the sense --------------------------------------------------- */}

      {word.lookupState === 'pending' && (
        <p className="mt-2 text-sm text-ink-faint italic">
          Saved offline — the definition will fill in when you're back online.
        </p>
      )}

      {word.lookupState === 'notfound' && !word.note && (
        <p className="mt-2 text-sm text-ink-faint italic">
          No dictionary entry found. Add your own meaning with the pencil.
        </p>
      )}

      {primary && (
        <p className="hanging mt-2 leading-[1.55] text-ink-soft">
          <span className="pr-1.5 font-text text-ink-faint italic">
            {abbreviatePartOfSpeech(primary.partOfSpeech)}
          </span>
          {primary.definition}
        </p>
      )}

      {/* The dictionary's own example, kept visually subordinate to the citation
          below: no rule, no attribution, just a quoted aside. */}
      {primary?.example && (
        <p className="mt-1.5 pl-[1.15em] text-[0.9375rem] leading-snug text-ink-faint italic">
          “{primary.example}”
        </p>
      )}

      {/* --- the citation: this book, this sentence ---------------------- */}

      {word.contextSentence && (
        <figure className="mt-3.5 border-l-2 border-rubric/50 pl-3.5">
          <blockquote className="font-text text-[1.0625rem] leading-[1.5] text-ink italic">
            {word.contextSentence}
          </blockquote>
          {(bookTitle || word.page) && (
            <figcaption className="label mt-1.5 !normal-case !tracking-normal">
              —{' '}
              {bookTitle && <cite className="font-text not-italic">{bookTitle}</cite>}
              {bookTitle && word.page ? ', ' : ''}
              {word.page && `p. ${word.page}`}
            </figcaption>
          )}
        </figure>
      )}

      {word.note && (
        <p className="mt-3 border-l-2 border-rule pl-3.5 text-[0.9375rem] leading-relaxed text-ink-soft">
          {word.note}
        </p>
      )}

      {/* --- further senses --------------------------------------------- */}

      {expanded && word.senses.length > 1 && (
        <div className="animate-rise mt-4 bg-paper-sunk/60 px-3.5 py-3">
          <p className="label mb-2">
            All senses · tap the one your book meant
          </p>
          <ol className="space-y-2">
            {word.senses.map((sense, senseIndex) => {
              const isPrimary = senseIndex === word.primarySense;
              return (
                <li key={`${sense.partOfSpeech}-${senseIndex}`}>
                  <button
                    type="button"
                    onClick={() => void updateWord(word.id, { primarySense: senseIndex })}
                    aria-pressed={isPrimary}
                    // A solid rule alongside the ink/faint step, matching the sense
                    // pickers in the two sheets. The accent-coloured number is decoration
                    // on top; it cannot be the signal, because a desaturated display
                    // renders it the same grey as the plain ones.
                    className={`flex w-full gap-2 border-l-2 py-1 pl-2 text-left text-[0.9375rem] leading-snug transition-colors ${
                      isPrimary
                        ? 'border-rubric bg-rubric-tint text-ink'
                        : 'border-transparent text-ink-faint hover:text-ink-soft'
                    }`}
                  >
                    <span
                      className={`font-mono text-[0.6875rem] leading-5 ${
                        isPrimary ? 'text-rubric' : 'text-ink-faint'
                      }`}
                    >
                      {senseIndex + 1}
                    </span>
                    <span className="flex-1">
                      <span className="pr-1.5 text-ink-faint italic">
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
      )}

      {/* --- footer: metadata and actions -------------------------------- */}

      <div className="mt-3 flex items-center gap-3">
        <span className="label">{formatEntryDate(word.addedAt)}</span>

        {/* Only when the citation above isn't already carrying it. A page recorded
            without a sentence has no citation to appear in, so it was saved and then
            shown nowhere; repeating it two lines under "— Moby Dick, p. 114" would just
            be noise. */}
        {!word.contextSentence && word.page && (
          <span className="label">p. {word.page}</span>
        )}

        {extraSenses > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            // Underlined so it reads as actionable next to the plain date label. In the
            // accent alone it is the same grey as the date once the display desaturates.
            className="label !tracking-[0.08em] text-rubric underline decoration-rubric underline-offset-2 transition-opacity hover:opacity-70"
          >
            {expanded ? 'Fewer senses' : `+${extraSenses} more ${extraSenses === 1 ? 'sense' : 'senses'}`}
          </button>
        )}

        <div className="flex-1" />

        {confirmingDelete ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="label !tracking-normal underline decoration-rule"
            >
              Keep
            </button>
            {/* Filled, not merely accented. Two underlined labels differing only in hue
                give you no way to tell the destructive one from the safe one on a
                desaturated display — which is the worst possible thing to leave ambiguous. */}
            <button
              type="button"
              onClick={() => void deleteWord(word.id)}
              className="label !tracking-normal bg-rubric px-2 py-1 text-paper-raised"
            >
              Remove
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onEdit(word)}
              aria-label={`Edit ${word.term}`}
              className="flex h-9 w-9 items-center justify-center text-ink-faint/60 transition-colors hover:text-ink"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                // The footer swaps to a confirm pair; a distinct pulse says so.
                warn();
                setConfirmingDelete(true);
              }}
              aria-label={`Remove ${word.term}`}
              className="flex h-9 w-9 items-center justify-center text-ink-faint/60 transition-colors hover:text-rubric"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </article>
  );
}
