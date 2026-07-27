/**
 * Lexicographic conventions.
 *
 * Dictionaries abbreviate parts of speech, and the abbreviation is part of what
 * makes an entry read as an entry rather than as a database row.
 */

const ABBREVIATIONS: Record<string, string> = {
  noun: 'n.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  pronoun: 'pron.',
  preposition: 'prep.',
  conjunction: 'conj.',
  interjection: 'interj.',
  determiner: 'det.',
  article: 'art.',
  numeral: 'num.',
  exclamation: 'excl.',
};

export function abbreviatePartOfSpeech(partOfSpeech: string): string {
  return ABBREVIATIONS[partOfSpeech.toLowerCase().trim()] ?? partOfSpeech;
}

/** "12 Oct 2026" — unambiguous, and reads like a catalogue card. */
export function formatEntryDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
