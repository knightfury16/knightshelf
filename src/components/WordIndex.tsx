import { useMemo, useState } from 'react';
import type { Word } from '../types';
import { abbreviatePartOfSpeech } from '../lib/lexicon';
import { StarIcon } from './Icons';

/**
 * The compact view: words only, no meanings.
 *
 * Set like the index at the back of a book — dense columns, dot leaders running out
 * to the page number. Because the meanings stay hidden until you ask, reading down
 * the list doubles as a recall test: either you remember the word, or you tap it
 * and find out you didn't.
 */

interface WordIndexProps {
  words: Word[];
  /** Tapping a row opens the full record. */
  onOpen: (word: Word) => void;
  /** Letter dividers, as in a real index. Only meaningful when sorted A–Z. */
  showLetters?: boolean;
}

type Row = { kind: 'letter'; letter: string } | { kind: 'word'; word: Word };

export function WordIndex({ words, onOpen, showLetters = false }: WordIndexProps) {
  /**
   * Bulk reveal only. A single tap opens the detail sheet instead, so the two
   * gestures don't compete: "Reveal all" is for scanning the whole list at once,
   * a tap is for going deep on one word.
   */
  const [revealed, setRevealed] = useState(false);

  const rows = useMemo<Row[]>(() => {
    if (!showLetters) return words.map((word) => ({ kind: 'word', word }));

    const out: Row[] = [];
    let current = '';
    for (const word of words) {
      const letter = (word.term[0] ?? '').toUpperCase();
      if (letter && letter !== current) {
        current = letter;
        out.push({ kind: 'letter', letter });
      }
      out.push({ kind: 'word', word });
    }
    return out;
  }, [words, showLetters]);

  return (
    <div className="py-3">
      <div className="flex items-center justify-between pb-2">
        <p className="label">Tap a word for its entry</p>
        <button
          type="button"
          onClick={() => setRevealed((value) => !value)}
          aria-pressed={revealed}
          className="label min-h-9 text-rubric transition-opacity hover:opacity-70"
        >
          {revealed ? 'Hide meanings' : 'Reveal meanings'}
        </button>
      </div>

      {/* One word per row. Multi-column packs more in, but reads as a grid to scan
          across rather than a list to run your eye down. */}
      <ul>
        {rows.map((row) => {
          if (row.kind === 'letter') {
            return (
              <li key={`letter-${row.letter}`} className="mt-4 mb-1.5 first:mt-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg leading-none text-rubric">
                    {row.letter}
                  </span>
                  <span className="h-px flex-1 bg-rule" />
                </div>
              </li>
            );
          }

          const { word } = row;
          const primary = word.senses[word.primarySense] ?? word.senses[0];

          return (
            <li key={word.id} className="border-b border-rule/60 last:border-b-0">
              <button
                type="button"
                onClick={() => onOpen(word)}
                className="flex w-full items-baseline gap-1.5 py-1 text-left"
              >
                <span className="font-text text-[1.0625rem] leading-snug text-ink transition-colors hover:text-rubric">
                  {word.term}
                </span>

                {word.starred && <StarIcon className="h-3 w-3 shrink-0 text-rubric" filled />}

                <span className="leader flex-1" aria-hidden />

                {word.page ? (
                  <span className="shrink-0 font-mono text-[0.6875rem] text-ink-faint">
                    {word.page}
                  </span>
                ) : (
                  <span className="shrink-0 font-mono text-[0.6875rem] text-ink-faint/40">—</span>
                )}
              </button>

              {revealed && (
                <div className="animate-rise pb-2 pl-2">
                  {primary ? (
                    <p className="text-[0.875rem] leading-snug text-ink-soft">
                      <span className="pr-1 text-ink-faint italic">
                        {abbreviatePartOfSpeech(primary.partOfSpeech)}
                      </span>
                      {primary.definition}
                    </p>
                  ) : (
                    <p className="text-[0.875rem] text-ink-faint italic">
                      {word.lookupState === 'pending' ? 'Awaiting definition.' : 'No definition.'}
                    </p>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
