import { describe, expect, it } from 'vitest';
import {
  BOOK_COLUMNS,
  BOOKS_SHEET,
  buildExportSheets,
  exportFileName,
  sanitizeSheetName,
} from './excel';
import type { Book, Word } from '../types';

/**
 * These are the highest-value tests in the project right now: the export is
 * currently the only backup, and a sheet-name collision would quietly merge two
 * books' words into one sheet, losing data with no error.
 */

function book(over: Partial<Book> = {}): Book {
  return {
    id: 'b1',
    title: 'Blood Meridian',
    author: 'Cormac McCarthy',
    status: 'reading',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function word(over: Partial<Word> = {}): Word {
  return {
    id: 'w1',
    bookId: 'b1',
    term: 'gunwale',
    senses: [{ partOfSpeech: 'noun', definition: 'The top edge of a hull.' }],
    primarySense: 0,
    starred: false,
    lookupState: 'resolved',
    addedAt: '2026-02-02T00:00:00.000Z',
    updatedAt: '2026-02-02T00:00:00.000Z',
    ...over,
  };
}

describe('sanitizeSheetName', () => {
  it('passes through a name Excel already accepts', () => {
    expect(sanitizeSheetName('Blood Meridian', new Set())).toBe('Blood Meridian');
  });

  it('replaces every character Excel forbids', () => {
    expect(sanitizeSheetName('A[B]C:D*E?F/G\\H', new Set())).toBe('A B C D E F G H');
  });

  it('truncates to Excel’s 31-character limit', () => {
    const long = 'The Brothers Karamazov: A Novel in Four Parts';
    const result = sanitizeSheetName(long, new Set());
    expect(result.length).toBeLessThanOrEqual(31);
  });

  it('disambiguates two books that share a title', () => {
    const taken = new Set<string>();
    expect(sanitizeSheetName('Moby Dick', taken)).toBe('Moby Dick');
    expect(sanitizeSheetName('Moby Dick', taken)).toBe('Moby Dick (2)');
    expect(sanitizeSheetName('Moby Dick', taken)).toBe('Moby Dick (3)');
  });

  it('treats names case-insensitively, as Excel does', () => {
    const taken = new Set<string>();
    sanitizeSheetName('Moby Dick', taken);
    expect(sanitizeSheetName('MOBY DICK', taken)).toBe('MOBY DICK (2)');
  });

  it('keeps a disambiguated name inside the length limit', () => {
    const taken = new Set<string>();
    const long = 'An Extremely Long Book Title That Overflows';
    const first = sanitizeSheetName(long, taken);
    const second = sanitizeSheetName(long, taken);
    expect(first.length).toBeLessThanOrEqual(31);
    expect(second.length).toBeLessThanOrEqual(31);
    expect(second).not.toBe(first);
  });

  it('falls back to a placeholder when nothing usable remains', () => {
    expect(sanitizeSheetName('///', new Set())).toBe('Untitled');
    expect(sanitizeSheetName('   ', new Set())).toBe('Untitled');
  });

  it('avoids the name Excel reserves for change tracking', () => {
    expect(sanitizeSheetName('History', new Set())).toBe('History (book)');
    expect(sanitizeSheetName('history', new Set())).toBe('History (book)');
  });

  it('strips apostrophes, which Excel rejects at the ends of a name', () => {
    expect(sanitizeSheetName("'Tis Pity", new Set())).toBe('Tis Pity');
  });

  it('does not let a book claim the reserved metadata sheet name', () => {
    const sheets = buildExportSheets([book({ title: BOOKS_SHEET })], []);
    const bookSheets = sheets.filter((sheet) => sheet.sheet !== BOOKS_SHEET);
    expect(bookSheets).toHaveLength(1);
    expect(bookSheets[0].sheet).not.toBe(BOOKS_SHEET);
  });
});

describe('buildExportSheets', () => {
  it('puts the metadata sheet first', () => {
    const sheets = buildExportSheets([book()], [word()]);
    expect(sheets[0].sheet).toBe(BOOKS_SHEET);
  });

  it('gives every book a sheet and records it in the metadata', () => {
    const sheets = buildExportSheets(
      [book(), book({ id: 'b2', title: 'Moby Dick' })],
      [word(), word({ id: 'w2', bookId: 'b2', term: 'ambergris' })],
    );

    expect(sheets).toHaveLength(3);
    const metadata = sheets[0];
    expect(metadata.rows).toHaveLength(2);
    // Sheet Name column must match the actual sheet, or import cannot map them back.
    const sheetNameColumn = BOOK_COLUMNS.indexOf('Sheet Name');
    const declared = metadata.rows.map((row) => row[sheetNameColumn]);
    const actual = sheets.slice(1).map((sheet) => sheet.sheet);
    expect(declared.sort()).toEqual(actual.sort());
  });

  it('declares no column it never fills', () => {
    // A permanently blank column reads as data loss when importing.
    const sheets = buildExportSheets([book()], [word()]);
    const metadata = sheets[0];
    metadata.header.forEach((_label, column) => {
      expect(metadata.rows.some((row) => row[column] !== '' && row[column] !== null)).toBe(true);
    });
  });

  it('keeps a book with no words, so it survives a round-trip', () => {
    const sheets = buildExportSheets([book({ id: 'b9', title: 'Unread' })], []);
    const sheet = sheets.find((candidate) => candidate.sheet === 'Unread');
    expect(sheet).toBeDefined();
    expect(sheet?.rows).toHaveLength(0);
  });

  it('exports the sense the reader chose, not merely the first', () => {
    const sheets = buildExportSheets(
      [book()],
      [
        word({
          term: 'sheet',
          primarySense: 1,
          senses: [
            { partOfSpeech: 'noun', definition: 'A thin bed cloth.' },
            { partOfSpeech: 'noun', definition: 'A rope controlling a sail.' },
          ],
        }),
      ],
    );

    const row = sheets.find((sheet) => sheet.sheet === 'Blood Meridian')?.rows[0];
    expect(row?.[3]).toBe('A rope controlling a sail.');
  });

  it('omits soft-deleted books and words', () => {
    const sheets = buildExportSheets(
      [book(), book({ id: 'b2', title: 'Deleted', deletedAt: '2026-03-03T00:00:00.000Z' })],
      [word(), word({ id: 'w2', deletedAt: '2026-03-03T00:00:00.000Z' })],
    );

    expect(sheets.map((sheet) => sheet.sheet)).not.toContain('Deleted');
    expect(sheets.find((sheet) => sheet.sheet === 'Blood Meridian')?.rows).toHaveLength(1);
  });

  it('carries the irreplaceable fields through', () => {
    const sheets = buildExportSheets(
      [book()],
      [
        word({
          contextSentence: 'He hauled the sheet taut.',
          page: '114',
          note: 'nautical',
          starred: true,
        }),
      ],
    );

    const row = sheets.find((sheet) => sheet.sheet === 'Blood Meridian')?.rows[0];
    expect(row?.[5]).toBe('He hauled the sheet taut.');
    expect(row?.[6]).toBe('114');
    expect(row?.[8]).toBe('nautical');
    expect(row?.[9]).toBe(true);
    expect(row?.[7]).toBeInstanceOf(Date);
  });
});

describe('exportFileName', () => {
  it('stamps the local date', () => {
    expect(exportFileName(new Date(2026, 6, 27))).toBe('knightshelf-2026-07-27.xlsx');
  });
});
