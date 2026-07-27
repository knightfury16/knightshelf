import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Book, LibraryData, Sense, Word } from '../types';
import { SCHEMA_VERSION } from '../types';
import { nowIso } from '../lib/id';

/**
 * IndexedDB is the working copy and the source of truth for the running app.
 * Phase 2 will push a flattened snapshot of it to a private GitHub repo.
 *
 * Books and words live in separate keyed stores rather than one blob, so saving
 * a single word doesn't rewrite the entire library on every capture.
 */

const DB_NAME = 'knightshelf';
const DB_VERSION = 1;

/** A cached dictionary response, so repeat lookups are instant and work offline. */
export interface CachedLookup {
  term: string;
  found: boolean;
  senses: Sense[];
  phonetic?: string;
  audioUrl?: string;
  fetchedAt: string;
}

interface KnightshelfDB extends DBSchema {
  books: { key: string; value: Book };
  words: { key: string; value: Word; indexes: { 'by-book': string } };
  lookups: { key: string; value: CachedLookup };
  meta: { key: string; value: string };
}

let dbPromise: Promise<IDBPDatabase<KnightshelfDB>> | null = null;

function getDb(): Promise<IDBPDatabase<KnightshelfDB>> {
  if (!dbPromise) {
    dbPromise = openDB<KnightshelfDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('books')) {
          db.createObjectStore('books', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('words')) {
          const words = db.createObjectStore('words', { keyPath: 'id' });
          words.createIndex('by-book', 'bookId');
        }
        if (!db.objectStoreNames.contains('lookups')) {
          db.createObjectStore('lookups', { keyPath: 'term' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta');
        }
      },
    });
  }
  return dbPromise;
}

const isLive = <T extends { deletedAt?: string }>(record: T): boolean => !record.deletedAt;

/* ------------------------------------------------------------------ books */

export async function listBooks(): Promise<Book[]> {
  const db = await getDb();
  const all = await db.getAll('books');
  return all.filter(isLive);
}

export async function getBook(id: string): Promise<Book | undefined> {
  const db = await getDb();
  const book = await db.get('books', id);
  return book && isLive(book) ? book : undefined;
}

export async function putBook(book: Book): Promise<void> {
  const db = await getDb();
  await db.put('books', book);
}

/**
 * Soft delete, cascading to the book's words.
 *
 * Hard deletes can't survive sync: the other device still holds the row and would
 * resurrect it on the next merge. A tombstone propagates instead.
 */
export async function softDeleteBook(id: string): Promise<void> {
  const db = await getDb();
  const stamp = nowIso();
  const tx = db.transaction(['books', 'words'], 'readwrite');

  const book = await tx.objectStore('books').get(id);
  if (book) {
    await tx.objectStore('books').put({ ...book, deletedAt: stamp, updatedAt: stamp });
  }

  const words = await tx.objectStore('words').index('by-book').getAll(id);
  await Promise.all(
    words
      .filter(isLive)
      .map((word) => tx.objectStore('words').put({ ...word, deletedAt: stamp, updatedAt: stamp })),
  );

  await tx.done;
}

/* ------------------------------------------------------------------ words */

export async function listWords(bookId?: string): Promise<Word[]> {
  const db = await getDb();
  const all = bookId
    ? await db.getAllFromIndex('words', 'by-book', bookId)
    : await db.getAll('words');
  return all.filter(isLive);
}

export async function getWord(id: string): Promise<Word | undefined> {
  const db = await getDb();
  const word = await db.get('words', id);
  return word && isLive(word) ? word : undefined;
}

export async function putWord(word: Word): Promise<void> {
  const db = await getDb();
  await db.put('words', word);
}

export async function softDeleteWord(id: string): Promise<void> {
  const db = await getDb();
  const word = await db.get('words', id);
  if (!word) return;
  const stamp = nowIso();
  await db.put('words', { ...word, deletedAt: stamp, updatedAt: stamp });
}

/* ---------------------------------------------------------- lookup cache */

export async function readCachedLookup(term: string): Promise<CachedLookup | undefined> {
  const db = await getDb();
  return db.get('lookups', term.toLowerCase());
}

export async function writeCachedLookup(entry: CachedLookup): Promise<void> {
  const db = await getDb();
  await db.put('lookups', { ...entry, term: entry.term.toLowerCase() });
}

/* ------------------------------------------------------------------- meta */

export async function readMeta(key: string): Promise<string | undefined> {
  const db = await getDb();
  return db.get('meta', key);
}

export async function writeMeta(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.put('meta', value, key);
}

/* -------------------------------------------------- whole-library access */

/**
 * Full snapshot **including tombstones** — this is what Phase 2 pushes and what
 * Phase 3 exports to Excel. Filtering deletes here would break the merge.
 */
export async function exportLibrary(): Promise<LibraryData> {
  const db = await getDb();
  const [books, words] = await Promise.all([db.getAll('books'), db.getAll('words')]);
  return { version: SCHEMA_VERSION, books, words };
}

/** Bulk write used by sync merges and Excel import. */
export async function writeRecords(books: Book[], words: Word[]): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['books', 'words'], 'readwrite');
  await Promise.all([
    ...books.map((book) => tx.objectStore('books').put(book)),
    ...words.map((word) => tx.objectStore('words').put(word)),
  ]);
  await tx.done;
}
