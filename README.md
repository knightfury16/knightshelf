# Knightshelf

A commonplace book for words met while reading physical books.

Add the book you're reading, look up words as you hit them, and every word files
itself under that book — with the sentence you found it in, cited like a dictionary
citation. Built as an installable PWA so it works from a phone with no connection.

## Commands

```bash
npm run dev        # dev server at http://localhost:5173
npm run build      # production build into dist/
npm run preview    # serve the production build at /knightshelf/
npm run typecheck  # tsc, no emit
npm run lint       # oxlint
npm run icons      # regenerate PWA icons from scripts/make-icons.mjs
```

## Status

**Phase 1 complete** — books, word capture, dictionary lookup, both reading views,
theming, PWA. Data is local to one browser.

Next: Phase 2 syncs to a private GitHub repo so the same shelf opens on phone and
desktop. Phase 3 adds Excel export/import (one sheet per book).

## Deploying to GitHub Pages

The repo **must be named `knightshelf`**, because `vite.config.ts` builds with
`base: '/knightshelf/'`. A different repo name means changing that value to match.

```bash
git init -b main
git add -A
git commit -m "feat: knightshelf phase 1"
git remote add origin https://github.com/<you>/knightshelf.git
git push -u origin main
```

Then in the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
The included workflow builds and publishes on every push to `main`. The app lands at
`https://<you>.github.io/knightshelf/` — open that on your phone and use Chrome's
**Add to Home screen** to install it.

Note that browser storage is per-origin, so words added on `localhost` do not appear
on `github.io`. That gap is exactly what Phase 2 closes.

## Architecture

```
src/
  api/          dictionary.ts (dictionaryapi.dev), openlibrary.ts — both keyless
  db/store.ts   IndexedDB via idb; books + words in separate keyed stores
  state/        LibraryContext.ts (context + hook), LibraryProvider.tsx, theme.ts
  components/   Sheet, LookupBar, WordEntry, WordIndex, BookCover, AddBookSheet, …
  screens/      Shelf, BookView, SearchView, SettingsView
  lib/          id, hash, hooks, lexicon
```

## Decisions worth not re-litigating

**Keyless APIs only.** A static site ships its JavaScript publicly, so any API key
would be public too. That rules out Merriam-Webster and Wordnik and leaves
dictionaryapi.dev and Open Library — both keyless.

**HashRouter, not BrowserRouter.** GitHub Pages has no server-side rewrite, so
`/knightshelf/book/xyz` would 404 on refresh or when launched from a home-screen
shortcut. It also keeps the document path at `/knightshelf/`, so relative asset
paths in `index.html` resolve correctly on deep links.

**`base` keyed on `mode`, not `command`.** `vite preview` runs with
`command: 'serve'` but `mode: 'production'`. Keying on `command` serves the built
app at `/` while its HTML requests `/knightshelf/...`, and every asset 404s.

**Soft deletes.** Records carry `deletedAt` rather than being removed. A hard
delete on one device gets resurrected by the next sync from a device that still
holds the row; a tombstone propagates instead.

**Fonts are not precached.** `@fontsource` ships every unicode subset. Precaching
pulls all of them — about 1 MB on a first visit. Left alone, the browser honours
each `@font-face`'s `unicode-range` and fetches only what the text needs; a runtime
CacheFirst rule then keeps whatever was fetched available offline. This is the
difference between a 993 KiB and a 330 KiB precache.

**`interactive-widget=resizes-content`.** Without it, Gboard covers the
bottom-pinned lookup bar you're typing into.

**Senses are capped at 12 per word.** Some words return 30+; the archive and the
eventual sync file both stay sane.

**External API responses are narrowed from `unknown`** before they reach storage,
and definitions render as text — never `dangerouslySetInnerHTML`. Untrusted
third-party content is the only injection vector in an app shaped like this.

## Design

A lexicographer's desk, not a cozy reading nook: laid paper, iron-gall ink, and
vermilion rubrication (scribes used red for headings). Instrument Serif for
headwords, Newsreader for definitions (with its optical-size axis, so letterforms
firm up at small sizes), IBM Plex Mono for catalogue-card metadata.

Entries are set as real dictionary entries, and the sentence from your book appears
as an attributed citation — the same move the OED makes when it cites literature to
illustrate a sense.

## Known non-issues

`npm audit` reports a react-router advisory for **RSC mode** CSRF. This app is a
static SPA with no server, no RSC, and no actions, so it does not apply — and npm's
suggested "fix" is a downgrade. The remaining advisories are in `workbox-build`'s
dependency chain, which is build-time only and never ships.
