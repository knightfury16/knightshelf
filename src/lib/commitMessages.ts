import type { Book, Word } from '../types';
import { stableStringify } from './merge';

/**
 * What each commit in the data repository says.
 *
 * Two jobs. It names the device, because sync authenticates with one token and every
 * commit would otherwise be indistinguishable. And it describes *the file being written*
 * rather than the whole run: a sync touching two books writes two files, and both used to
 * carry the same global totals, which made the history read as though each book had
 * received every word.
 *
 * Every message is a single line. `sanitizeForCommit` is not defensive decoration: book
 * titles come from Open Library or from a free-text field, so a title holding a newline
 * would otherwise split the subject and forge a commit body.
 */

/** Long enough for a real title, short enough to keep `git log --oneline` readable. */
const MAX_TITLE_LENGTH = 48;
const MAX_DEVICE_LENGTH = 32;

/** Used when the shelf has no record of the book a shard belongs to. */
const UNFILED = 'an unfiled book';

/** Used when no device name reached the engine, so a message is still well-formed. */
const UNKNOWN_DEVICE = 'An unnamed device';

/**
 * Anything that could end a line or steer a terminal: C0 controls, DEL, the C1 block, and
 * the two Unicode line separators.
 *
 * Tested by code point rather than matched by a character class, so this file holds no
 * literal control characters of its own — which keeps it readable and greppable.
 */
function isControl(codePoint: number): boolean {
  return (
    codePoint < 0x20 ||
    codePoint === 0x7f ||
    (codePoint >= 0x80 && codePoint <= 0x9f) ||
    codePoint === 0x2028 ||
    codePoint === 0x2029
  );
}

/**
 * Flattens text to one clean line and truncates it.
 *
 * Controls become spaces *before* whitespace runs collapse, so a newline turns into a
 * single space rather than joining two words into one.
 */
export function sanitizeForCommit(text: string, maxLength: number): string {
  let cleaned = '';
  // Iterating the string yields whole code points, so surrogate pairs survive intact.
  for (const character of text) {
    cleaned += isControl(character.codePointAt(0) ?? 0) ? ' ' : character;
  }

  const flattened = cleaned.replace(/\s+/g, ' ').trim();
  if (flattened.length <= maxLength) return flattened;
  return `${flattened.slice(0, maxLength - 1).trimEnd()}…`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export interface WordChanges {
  added: number;
  updated: number;
}

/**
 * How this book's file differs from what the remote had.
 *
 * `previous` is undefined when the file does not exist yet, which makes every word new.
 *
 * A deletion counts as an update, not a removal: deletes are soft, so a removed word is
 * still present with `deletedAt` set. Reporting it as "updated" is true, if quiet.
 */
export function countWordChanges(next: Word[], previous: Word[] | undefined): WordChanges {
  if (!previous) return { added: next.length, updated: 0 };

  const before = new Map(previous.map((word) => [word.id, word]));
  let added = 0;
  let updated = 0;

  for (const word of next) {
    const old = before.get(word.id);
    if (!old) added += 1;
    else if (stableStringify(old) !== stableStringify(word)) updated += 1;
  }

  return { added, updated };
}

export interface BookChanges {
  added: Book[];
  removed: Book[];
}

/** Removed means a tombstone appeared, since the record itself never leaves. */
export function countBookChanges(next: Book[], previous: Book[]): BookChanges {
  const before = new Map(previous.map((book) => [book.id, book]));

  const added: Book[] = [];
  const removed: Book[] = [];

  for (const book of next) {
    const old = before.get(book.id);
    if (!old) {
      // A book that arrives already deleted is not worth announcing as an addition.
      if (book.deletedAt) removed.push(book);
      else added.push(book);
    } else if (book.deletedAt && !old.deletedAt) {
      removed.push(book);
    }
  }

  return { added, removed };
}

function device(name: string | undefined): string {
  const clean = sanitizeForCommit(name ?? '', MAX_DEVICE_LENGTH);
  return clean.length > 0 ? clean : UNKNOWN_DEVICE;
}

function title(bookTitle: string | undefined): string {
  const clean = sanitizeForCommit(bookTitle ?? '', MAX_TITLE_LENGTH);
  return clean.length > 0 ? clean : UNFILED;
}

export interface ShardMessageInput extends WordChanges {
  deviceName?: string;
  bookTitle?: string;
}

/** One book's file: `Brave Otter — 3 words added to Moby Dick`. */
export function shardCommitMessage({
  deviceName,
  bookTitle,
  added,
  updated,
}: ShardMessageInput): string {
  const book = title(bookTitle);

  let change: string;
  if (added > 0 && updated > 0) {
    change = `${plural(added, 'word')} added, ${updated} updated in ${book}`;
  } else if (added > 0) {
    change = `${plural(added, 'word')} added to ${book}`;
  } else if (updated > 0) {
    change = `${plural(updated, 'word')} updated in ${book}`;
  } else {
    // The write only happens when the revision moved, so this should be unreachable —
    // but a commit with no message at all would be worse than a vague one.
    change = `words updated in ${book}`;
  }

  return `${device(deviceName)} — ${change}`;
}

export interface ManifestMessageInput extends BookChanges {
  deviceName?: string;
}

/**
 * The catalogue file, which is rewritten on nearly every sync.
 *
 * Because it moves whenever any book's revision moves, most of its commits carry no news
 * at all — hence a deliberately quiet phrase for that case rather than a claim that
 * something changed.
 */
export function manifestCommitMessage({
  deviceName,
  added,
  removed,
}: ManifestMessageInput): string {
  let change: string;
  if (added.length > 0 && removed.length > 0) {
    change = `${plural(added.length, 'book')} added, ${removed.length} removed from the shelf`;
  } else if (added.length === 1) {
    change = `${title(added[0].title)} added to the shelf`;
  } else if (added.length > 1) {
    change = `${plural(added.length, 'book')} added to the shelf`;
  } else if (removed.length === 1) {
    change = `${title(removed[0].title)} removed from the shelf`;
  } else if (removed.length > 1) {
    change = `${plural(removed.length, 'book')} removed from the shelf`;
  } else {
    change = 'index updated';
  }

  return `${device(deviceName)} — ${change}`;
}

/** The one-off commit that empties the pre-sharding single file. */
export function legacyRetiredMessage(deviceName?: string): string {
  return `${device(deviceName)} — moved to per-book files`;
}
