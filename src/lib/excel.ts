import type { Book, Word } from '../types';

/**
 * Excel export: one sheet per book, plus a `_Books` metadata sheet.
 *
 * The metadata sheet is what makes a future import lossless. Excel truncates sheet
 * names to 31 characters and forbids `[ ] : * ? / \`, so "The Brothers Karamazov: A
 * Novel" cannot survive as a sheet name — `_Books` maps the mangled name back to the
 * real book, and carries the ids so an import can update rather than duplicate.
 *
 * The sheet-building functions here are pure and unit-tested, because a sheet-name
 * collision would silently merge two books' words into one sheet and lose data.
 */

export const BOOKS_SHEET = '_Books';

/** Excel's hard limit on sheet-name length. */
const MAX_SHEET_NAME = 31;

/** Characters Excel rejects in a sheet name. */
const FORBIDDEN = /[[\]:*?/\\]/g;

export type ExportValue = string | number | boolean | Date | null;

export interface ExportSheet {
  sheet: string;
  header: string[];
  rows: ExportValue[][];
}

export const WORD_COLUMNS = [
  'Id',
  'Word',
  'Part of Speech',
  'Definition',
  'Example',
  'Context from Book',
  'Page',
  'Date Added',
  'Note',
  'Starred',
];

/**
 * No ISBN column: nothing currently populates `Book.isbn`. Open Library's search
 * omits ISBNs by design (a work returns one per edition, often hundreds), and manual
 * entry has no field for it. A permanently blank column reads like data loss during
 * an import, so it is better absent until there is something to put in it. Import
 * matches on `Id` regardless.
 */
export const BOOK_COLUMNS = ['Id', 'Title', 'Author', 'Status', 'Sheet Name', 'Words'];

/**
 * Produces a valid, unique sheet name for a book title.
 *
 * `taken` is mutated with the accepted name — Excel treats sheet names
 * case-insensitively for uniqueness, so entries are stored lowercased.
 */
export function sanitizeSheetName(rawTitle: string, taken: Set<string>): string {
  let base = rawTitle
    .replace(FORBIDDEN, ' ')
    // Excel refuses a name that starts or ends with an apostrophe; dropping them all
    // is simpler than special-casing the ends and reads no worse.
    .replace(/'/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base) base = 'Untitled';

  // "History" is reserved by Excel for its own change-tracking sheet.
  if (base.toLowerCase() === 'history') base = 'History (book)';

  base = base.slice(0, MAX_SHEET_NAME).trim();

  if (!taken.has(base.toLowerCase())) {
    taken.add(base.toLowerCase());
    return base;
  }

  // Two books can legitimately share a title, or be truncated into sharing one.
  for (let n = 2; n < 1000; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, MAX_SHEET_NAME - suffix.length).trim()}${suffix}`;
    if (!taken.has(candidate.toLowerCase())) {
      taken.add(candidate.toLowerCase());
      return candidate;
    }
  }

  throw new Error(`Could not derive a unique sheet name for “${rawTitle}”.`);
}

const isLive = <T extends { deletedAt?: string }>(record: T): boolean => !record.deletedAt;

function toDate(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * One row per word, using the sense you marked as the one your book meant.
 *
 * Deliberately not one row per sense: twelve rows for "sheet" would make the sheet
 * unreadable. Unused senses are re-fetchable from the dictionary anyway — whereas
 * your sentence, page, note and date exist nowhere else, and all are preserved.
 */
function wordRow(word: Word): ExportValue[] {
  const sense = word.senses[word.primarySense] ?? word.senses[0];
  return [
    word.id,
    word.term,
    sense?.partOfSpeech ?? '',
    sense?.definition ?? '',
    sense?.example ?? '',
    word.contextSentence ?? '',
    word.page ?? '',
    toDate(word.addedAt),
    word.note ?? '',
    word.starred,
  ];
}

/** Pure: everything needed to write the workbook, with no dependency on the writer. */
export function buildExportSheets(books: Book[], words: Word[]): ExportSheet[] {
  const liveBooks = books.filter(isLive);
  const liveWords = words.filter(isLive);

  // Reserve the metadata sheet name so a book actually titled "_Books" can't take it.
  const taken = new Set<string>([BOOKS_SHEET.toLowerCase()]);

  const byBook = new Map<string, Word[]>();
  for (const word of liveWords) {
    const list = byBook.get(word.bookId);
    if (list) list.push(word);
    else byBook.set(word.bookId, [word]);
  }

  const ordered = [...liveBooks].sort((a, b) => a.title.localeCompare(b.title));

  const bookRows: ExportValue[][] = [];
  const wordSheets: ExportSheet[] = [];

  for (const book of ordered) {
    const sheetName = sanitizeSheetName(book.title, taken);
    const bookWords = (byBook.get(book.id) ?? []).sort((a, b) =>
      a.term.localeCompare(b.term, undefined, { sensitivity: 'base' }),
    );

    bookRows.push([
      book.id,
      book.title,
      book.author ?? '',
      book.status,
      sheetName,
      bookWords.length,
    ]);

    // Books with no words still get a sheet, so the book itself survives a round-trip.
    wordSheets.push({
      sheet: sheetName,
      header: WORD_COLUMNS,
      rows: bookWords.map(wordRow),
    });
  }

  return [{ sheet: BOOKS_SHEET, header: BOOK_COLUMNS, rows: bookRows }, ...wordSheets];
}

/** `knightshelf-2026-07-27.xlsx` */
export function exportFileName(now: Date): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  return `knightshelf-${stamp}.xlsx`;
}

/**
 * Builds the workbook. The writer is imported dynamically so its weight only lands
 * when someone actually exports — it has no business in the initial bundle of an app
 * whose main job is looking up a word.
 */
export async function buildXlsxBlob(books: Book[], words: Word[]): Promise<Blob> {
  // No root export in this package; the browser entry point must be explicit.
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  const sheets = buildExportSheets(books, words).map((sheet) => ({
    sheet: sheet.sheet,
    data: [
      sheet.header.map((label) => ({ value: label, type: String, fontWeight: 'bold' as const })),
      ...sheet.rows.map((row) =>
        row.map((value) => {
          if (value === null || value === undefined) return { value: '', type: String };
          if (value instanceof Date) return { value, type: Date, format: 'yyyy-mm-dd' };
          if (typeof value === 'boolean') return { value, type: Boolean };
          if (typeof value === 'number') return { value, type: Number };
          return { value, type: String };
        }),
      ),
    ],
  }));

  return writeXlsxFile(sheets).toBlob();
}

/** Hands the blob to the browser as a download. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  // Give the download a tick to start before invalidating the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
