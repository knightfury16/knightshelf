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
  onOpen: (word: Word) => void;
  /** Letter dividers, as in a real index. Only meaningful when sorted A–Z. */
  showLetters?: boolean;
}

type Row = { kind: 'letter'; letter: string } | { kind: 'word'; word: Word };

export function WordIndex({ words, onOpen, showLetters = false }: WordIndexProps) {
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

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

  function toggle(id: string): void {
    setRevealed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const allRevealed = revealed.size > 0 && revealed.size === words.length;

  return (
    <div className="py-3">
      <div className="flex items-center justify-between pb-2">
        <p className="label">Tap a word to check yourself</p>
        <button
          type="button"
          onClick={() =>
            setRevealed(allRevealed ? new Set() : new Set(words.map((word) => word.id)))
          }
          className="label min-h-9 text-rubric transition-opacity hover:opacity-70"
        >
          {allRevealed ? 'Hide all' : 'Reveal all'}
        </button>
      </div>

      <ul className="columns-2 gap-x-6 sm:columns-3 sm:gap-x-8 lg:columns-4">
        {rows.map((row) => {
          if (row.kind === 'letter') {
            return (
              <li
                key={`letter-${row.letter}`}
                className="mt-3 mb-1.5 break-inside-avoid first:mt-0"
              >
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
          const isOpen = revealed.has(word.id);
          const primary = word.senses[word.primarySense] ?? word.senses[0];

          return (
            <li key={word.id} className="mb-1 break-inside-avoid">
              <button
                type="button"
                onClick={() => toggle(word.id)}
                aria-expanded={isOpen}
                className="flex w-full items-baseline gap-1.5 py-1 text-left"
              >
                <span
                  className={`font-text text-[1.0625rem] leading-snug transition-colors ${
                    isOpen ? 'text-rubric' : 'text-ink'
                  }`}
                >
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

              {isOpen && (
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

                  {word.contextSentence && (
                    <p className="mt-1 border-l border-rubric/40 pl-2 text-[0.8125rem] leading-snug text-ink-faint italic">
                      {word.contextSentence}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => onOpen(word)}
                    className="label mt-1.5 min-h-9 text-rubric transition-opacity hover:opacity-70"
                  >
                    Edit
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
