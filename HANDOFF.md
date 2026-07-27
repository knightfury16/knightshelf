# Handoff

Current status, decisions already made, and the task list. Update this file as work
lands so the next session starts oriented.

**Last updated:** 2026-07-27 · end of Phase 1, plus the word detail sheet

---

## Status

**Phase 1 is complete and verified.** The app is usable daily on one device. Data
lives in that browser's IndexedDB only.

Not yet done: cross-device sync (Phase 2), Excel export/import (Phase 3).

The user reads a lot of physical books and built this because Google searches for
words get lost in history, with no way to ask "what did this book teach me?"

---

## Decisions the user already made — do not re-open

These came out of a design conversation. Treat them as settled.

| Decision | Choice |
|---|---|
| Hosting | GitHub Pages, repo named `knightshelf` (public, code only) |
| Data storage | Separate **private** repo `knightshelf-data`, holding one JSON file |
| Purpose | An **archive** to look back on — not a spaced-repetition study tool |
| Book entry | Open Library title search, with manual entry as fallback |
| Primary device | **Pixel 8** (Chrome/Android, 412×915 CSS viewport) — phone-first |
| Tab bar inside a book | Stays hidden; the lookup bar owns the bottom edge |
| Launch behaviour | Open straight into the current book with the field focused |

On launch target: every book starts as `reading`, so "current book" is resolved as
**most recently active**, where activity counts word captures rather than only edits
to the book record (`currentlyReadingBook` in `src/lib/stats.ts`). The user accepted
this; if they later want to pin one book explicitly, it's a small change.

---

## What Phase 1 delivers

- **Shelf** — covers on drawn shelf lines, uneven heights per book (stable, derived
  from id hash), coverless books get a typeset cloth binding. Stats colophon.
- **Book** — dictionary-style entries with the book sentence as an attributed
  citation; filter; Recent/A–Z; **Entries/Index** view toggle (persisted).
- **Index view** — words only, dense columns, dot leaders to page number, letter
  dividers when sorted A–Z. "Reveal meanings" shows every definition inline for
  scanning; a single tap opens the detail sheet instead, so the two gestures don't
  compete.
- **Word detail sheet** — one canonical read-only record per word, reachable from an
  entry headword, an index row, or a search hit. Citation first (it's the part only
  the reader has), then every sense with the primary marked and switchable, note,
  dates. Editing hands off to `WordFormSheet` so only one sheet is ever open.
- **Lookup** — bottom-pinned, debounced, sense picking (a nautical novel's "sheet" is
  a rope, and the dictionary returns "bed cloth" first), optional book sentence and
  page. Saves offline as `pending` and resolves definitions when back online.
- **Search** — across all books; falls back to starred words when the query is empty.
- **Cross-book notice** — "You also met this in *Blood Meridian*."
- **Settings** — light/dark/system theme.
- **PWA** — installable, offline, maskable icon, 330 KiB precache.

Verified end to end in the browser: Open Library search, book add, lookup, sense
pick, citation, save, reload persistence, starring, index view, launch redirect,
autofocus on reading books and *not* on finished ones, and a production build serving
at `/knightshelf/` with an activated service worker.

---

## Awaiting the user

- [ ] **Confirm Gboard behaviour on the Pixel 8.** Chrome only raises the keyboard
      for a programmatic focus inside a user-gesture chain. Tapping a book from the
      shelf qualifies; a *cold app launch* may not, so the caret may land without the
      keyboard appearing. If it needs a tap, add a visible "tap to look up" affordance
      rather than fighting the gesture policy. Could not be tested from the dev box.
- [x] **Deployed.** Live at `https://knightfury16.github.io/knightshelf/` via the
      Actions workflow. The first attempt failed with a 404 on "create deployment"
      because Pages had never been enabled; `configure-pages` with `enablement: true`
      now handles that for a fresh clone, but an existing repo set to deploy from a
      branch still needs Settings → Pages → Source → GitHub Actions.
- [ ] **Test the installed PWA on the phone** — add to home screen, add a book, check
      it still works with the network off.

---

## Task list

### Phase 2 — sync to a private GitHub repo

Goal: the same shelf opens on phone and desktop. This is the highest-value remaining
work; the user explicitly wants it next.

- [ ] **2.1 Settings: token entry.** Field for a fine-grained PAT plus the data repo
      `owner/name`. Persist in `localStorage`. Never log it, never send it anywhere
      but `api.github.com`. Include a link to GitHub's token page and state the
      required scope: **contents: read and write on `knightshelf-data` only**.
- [ ] **2.2 `src/api/github.ts`.** Read and write one file via the Contents API.
      - `GET /repos/{owner}/{repo}/contents/{path}` → `{ content: base64, sha }`
      - `PUT` same path with `{ message, content: base64, sha }`
      - 404 on GET means first run — treat as an empty library, omit `sha` on PUT.
      - **Base64 must be UTF-8 safe.** Naive `btoa(JSON.stringify(data))` throws on
        the IPA in phonetics (`/ˈɡʌnəl/`) and on curly quotes. Encode with
        `TextEncoder` then base64 the bytes, and reverse with `TextDecoder`.
      - Narrow the response from `unknown` like the other API clients.
- [ ] **2.3 Merge.** Pure function, unit-testable, no I/O:
      `merge(local: LibraryData, remote: LibraryData): LibraryData`
      — union by `id`, newest `updatedAt` wins, tombstones (`deletedAt`) respected.
      The data is append-mostly, so genuine conflicts are near-impossible by design.
- [ ] **2.4 Sync engine.** Pull-merge-push. Persist the last known `sha` via the
      existing `readMeta`/`writeMeta`. Debounce pushes a few seconds after the last
      change; also push on `visibilitychange` to hidden. On **409 conflict**, re-GET,
      re-merge, retry once — do not force-overwrite, that loses the other device's
      words. Write merged results with `store.writeRecords`.
- [ ] **2.5 Sync status UI.** Last-synced time, in-flight indicator, and a clear
      error state. Offline must degrade quietly — the app already works without it.
- [ ] **2.6 Verify** with two browser profiles: add a word in each, confirm both
      converge, then confirm a delete on one propagates instead of resurrecting.

`exportLibrary()` in `src/db/store.ts` already returns exactly the `LibraryData`
shape (`{ version, books, words }`, tombstones included) intended as the file format.

### Phase 3 — Excel export and import

The user asked for this explicitly: one sheet per book.

- [ ] **3.1 Export** with SheetJS (`xlsx`), client-side.
      - One sheet per book: `Id | Word | Part of Speech | Definition | Example |
        Context from Book | Page | Date Added | Note | Starred`
      - Include `Id` so a round-trip updates rather than duplicates.
      - Plus a `_Books` sheet: `Id | Title | Author | ISBN | Status | Sheet Name`.
        This is what makes import lossless — Excel truncates sheet names to 31 chars
        and forbids `[ ] : * ? / \`, so mangled names must map back to real books.
      - Sanitize and de-duplicate sheet names.
- [ ] **3.2 Import.** Read `_Books` first, match books by `Id`, fall back to title.
      Match words by `Id`. Validate every cell (untrusted input). Show a summary
      before committing — how many books and words will be added versus updated.
- [ ] **3.3 Verify** a full export → import round-trip changes nothing.

### Phase 4 — optional polish

Only if the user asks; nothing here is committed.

- [ ] Audio pronunciation is already stored and played; no review UI exists by design
      (the user chose archive over study tool).
- [ ] Richer stats — lookups over time, most-cited pages.
- [ ] Bulk edit or move words between books.

---

## Known gaps

- **No automated tests.** The user's global rules ask for 80% coverage; none is set up
  yet. The best candidates are the pure functions: `merge` (2.3), `computeStats`,
  `currentlyReadingBook`, `crossBookTermIndex`, and the sheet-name sanitizer. Worth
  adding Vitest alongside Phase 2, since merge correctness is where data loss lives.
- **Senses capped at 12** per word (`MAX_SENSES` in `src/api/dictionary.ts`) to keep
  the archive and the sync file manageable.
- **Storage is per-origin**, so words added on `localhost` do not appear on
  `github.io`. Expected; Phase 2 is the fix.
- The in-app browser used during Phase 1 contains two throwaway test books (*Blood
  Meridian*, *Moby Dick*). Not the user's real data — theirs is in a separate profile.
