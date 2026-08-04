import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import type { LookupState, Sense, Word } from '../types';
import { useLibrary } from '../state/LibraryContext';
import { abbreviatePartOfSpeech } from '../lib/lexicon';
import { commit } from '../lib/haptics';
import { ReferenceLinks } from './ReferenceLinks';

/**
 * The detail form, used for both capturing a new word and editing an existing
 * one. The two share almost every field, so they share one component.
 */

export interface WordDraft {
  term: string;
  senses: Sense[];
  lookupState: LookupState;
  phonetic?: string;
  audioUrl?: string;
}

interface WordFormSheetProps {
  open: boolean;
  onClose: () => void;
  bookId: string;
  /** Provide to edit an existing entry; omit to capture a new one from `draft`. */
  word?: Word;
  draft?: WordDraft;
}

export function WordFormSheet({ open, onClose, bookId, word, draft }: WordFormSheetProps) {
  const { saveWord, updateWord } = useLibrary();

  const source: WordDraft | undefined = word ?? draft;

  const [term, setTerm] = useState('');
  const [primarySense, setPrimarySense] = useState(0);
  const [contextSentence, setContextSentence] = useState('');
  const [page, setPage] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  // Reload the form whenever it opens against a different word.
  useEffect(() => {
    if (!open || !source) return;
    setTerm(source.term);
    setPrimarySense(word?.primarySense ?? 0);
    setContextSentence(word?.contextSentence ?? '');
    setPage(word?.page ?? '');
    setNote(word?.note ?? '');
  }, [open, source, word]);

  if (!source) return null;

  // Bound after the guard: narrowing on `source` doesn't reach into the hoisted
  // `submit` declaration below, since TS can't prove when it gets called.
  const active: WordDraft = source;
  const senses = active.senses;
  const hasDefinition = senses.length > 0;

  async function submit(): Promise<void> {
    const trimmed = term.trim();
    if (!trimmed || saving) return;

    setSaving(true);
    try {
      if (word) {
        await updateWord(word.id, {
          term: trimmed,
          primarySense,
          contextSentence: contextSentence.trim() || undefined,
          page: page.trim() || undefined,
          note: note.trim() || undefined,
        });
      } else {
        await saveWord({
          bookId,
          term: trimmed,
          senses,
          primarySense,
          lookupState: active.lookupState,
          phonetic: active.phonetic,
          audioUrl: active.audioUrl,
          contextSentence,
          page,
          note,
        });
      }
      commit();
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={word ? 'Edit entry' : source.term}
      subtitle={
        word
          ? undefined
          : source.lookupState === 'pending'
            ? 'No connection — the definition will fill in later'
            : hasDefinition
              ? // The phonetic, as a dictionary would set it. It used to read "Add the
                // sentence you found it in", which advertised the wrong field: you open
                // this sheet to read the meaning first.
                active.phonetic
              : 'No dictionary entry — record your own meaning'
      }
      // Opened to be read before it is filled in. Focusing the first field scrolled the
      // definition off screen and raised the keyboard over what was left.
      autoFocusField={false}
      footer={
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving || term.trim().length === 0}
          className="min-h-11 w-full bg-rubric px-4 text-paper-raised transition-opacity disabled:opacity-40"
        >
          {saving ? 'Saving…' : word ? 'Save changes' : 'Save to this book'}
        </button>
      }
    >
      <div className="space-y-5">
        {word && (
          <label className="block">
            <span className="label">Word</span>
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              className="mt-1.5 min-h-11 w-full border-b border-rule bg-transparent pb-1.5 font-display text-2xl outline-none focus:border-rubric"
            />
          </label>
        )}

        {senses.length > 1 && (
          <fieldset>
            <legend className="label">Which sense did your book mean?</legend>
            <ol className="mt-2 space-y-1">
              {senses.map((sense, index) => {
                const selected = index === primarySense;
                return (
                  <li key={`${sense.partOfSpeech}-${index}`}>
                    <button
                      type="button"
                      onClick={() => setPrimarySense(index)}
                      aria-pressed={selected}
                      // Solid rule, darker surface, and full-strength ink — three cues, so
                      // the choice is still legible once a greyscale display has thrown
                      // the hue away.
                      className={`flex w-full gap-2.5 border-l-2 py-2 pl-2.5 text-left text-[0.9375rem] leading-snug transition-colors ${
                        selected
                          ? 'border-rubric bg-rubric-tint text-ink'
                          : 'border-transparent text-ink-faint hover:border-rule hover:text-ink-soft'
                      }`}
                    >
                      <span
                        className={`font-mono text-[0.6875rem] leading-5 ${
                          selected ? 'text-rubric' : ''
                        }`}
                      >
                        {index + 1}
                      </span>
                      <span className="flex-1">
                        <span className="pr-1.5 italic">
                          {abbreviatePartOfSpeech(sense.partOfSpeech)}
                        </span>
                        {sense.definition}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </fieldset>
        )}

        {senses.length === 1 && (
          <div>
            <p className="label">Definition</p>
            <p className="hanging mt-1.5 text-ink-soft">
              <span className="pr-1.5 text-ink-faint italic">
                {abbreviatePartOfSpeech(senses[0].partOfSpeech)}
              </span>
              {senses[0].definition}
            </p>
          </div>
        )}

        <label className="block">
          <span className="label">Sentence from the book</span>
          <textarea
            value={contextSentence}
            onChange={(event) => setContextSentence(event.target.value)}
            rows={3}
            placeholder="Copy the line you met it in — it's the part you can't reconstruct later."
            className="mt-1.5 w-full resize-none border border-rule bg-transparent p-2.5 font-text leading-relaxed italic outline-none focus:border-rubric"
          />
        </label>

        <div className="flex gap-4">
          <label className="block w-28">
            <span className="label">Page</span>
            <input
              value={page}
              onChange={(event) => setPage(event.target.value)}
              inputMode="numeric"
              placeholder="114"
              className="mt-1.5 min-h-11 w-full border-b border-rule bg-transparent pb-1.5 font-mono text-sm outline-none focus:border-rubric"
            />
          </label>
        </div>

        <label className="block">
          <span className="label">{hasDefinition ? 'Your note' : 'Your meaning'}</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            placeholder={
              hasDefinition
                ? 'Anything worth remembering about it.'
                : 'Write the meaning as you understand it.'
            }
            className="mt-1.5 w-full resize-none border border-rule bg-transparent p-2.5 leading-relaxed outline-none focus:border-rubric"
          />
        </label>

        <hr className="rule-line" />

        {/* Last, matching WordDetailSheet: a fallback for when the dictionary is thin,
            not the headline. Following a link from here used to lose the unsaved word
            entirely, so it commits first — and its own label says so, which is why this
            keeps the label rather than sitting under a heading of its own. */}
        <ReferenceLinks
          term={term || active.term}
          label={word ? 'Save changes & look up' : 'Save & look up'}
          beforeNavigate={submit}
        />
      </div>
    </Sheet>
  );
}
