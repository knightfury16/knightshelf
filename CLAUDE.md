# Knightshelf — working notes for agents

A personal vocabulary archive for words met while reading **physical** books. Add a
book, look words up as you hit them, and each word files under that book with the
sentence you found it in. Static PWA, hosted on GitHub Pages, phone-first.

**Read [HANDOFF.md](HANDOFF.md) before starting work** — it holds current status, the
task list, and specs for the unbuilt phases.

## Commands

```bash
npm run dev        # localhost:5173
npm run build      # -> dist/  (also regenerates the service worker)
npm run preview    # serves the production build at /knightshelf/
npm run typecheck  # tsc -b
npm run lint       # oxlint
npm run icons      # regenerate PWA icons after editing scripts/make-icons.mjs
```

Run `npm run typecheck && npm run lint && npm run build` before declaring work done.

## Layout

```
src/
  api/          dictionary.ts (dictionaryapi.dev), openlibrary.ts — both keyless
  db/store.ts   IndexedDB via idb; books + words in separate keyed stores
  state/        LibraryContext.ts (context + hook), LibraryProvider.tsx, theme.ts
  components/   Sheet, LookupBar, WordEntry, WordIndex, BookCover, AddBookSheet, …
  screens/      Shelf, BookView, SearchView, SettingsView
  lib/          id, hash, hooks, lexicon, stats
scripts/        make-icons.mjs (sharp -> public/*.png)
.github/        Pages deploy workflow
```

## Constraints that will bite you

**Keyless APIs only.** A static site publishes its JavaScript, so any API key is
public. Do not introduce Merriam-Webster, Wordnik, or anything requiring a key.

**`base` is keyed on `mode`, not `command`.** `vite preview` runs with
`command: 'serve'` but `mode: 'production'`. Keying on `command` serves the built app
at `/` while its HTML requests `/knightshelf/...`, 404ing every asset. Already fixed
in `vite.config.ts` — don't "simplify" it back.

**HashRouter is required, not a preference.** GitHub Pages has no server-side
rewrite, so `/knightshelf/book/xyz` 404s on refresh and in the installed PWA. It also
keeps the document path at `/knightshelf/`, which is why relative asset paths in
`index.html` resolve on deep links. Do not switch to BrowserRouter.

**Never precache fonts.** `@fontsource` ships every unicode subset. Precaching pulls
Vietnamese and Latin-Extended you'll never need (993 KiB vs 330 KiB). Fonts are
runtime-cached so `unicode-range` fetches only what the text uses.

**Deletes are soft.** Records carry `deletedAt`. A hard delete gets resurrected by
the next sync from a device that still holds the row. `exportLibrary()` deliberately
includes tombstones; `listBooks`/`listWords` filter them.

**All external API responses are narrowed from `unknown`** before touching storage,
and definitions render as text. Never use `dangerouslySetInnerHTML` — third-party
content is the only injection vector in an app shaped like this.

**`Sheet` focuses the first form field, not the first focusable.** A naive query
lands on the Close button, which swallows typing (space activates it) and leaves the
mobile keyboard shut. Use `data-autofocus` to override.

## Environment traps that waste time

**Restart the dev server after renaming or deleting a module.** Vite caches the
resolved path and keeps requesting the old file, producing a blank page with a
`Failed to load url .../Foo.tsx` error while the production build succeeds fine.

**The in-app Browser pane often does not composite frames.** Screenshots fail, and —
less obviously — **CSS transitions never advance**, so `getComputedStyle` returns the
transition's *start* value indefinitely. A `transition-colors` element will look like
it has the wrong colour. Confirm with `el.style.transition = 'none'` before treating
it as a CSS bug. Verify visuals via the DOM and computed styles, or ask the user for
a screenshot.

## Style

Follow the user's global rules (immutable updates, small focused files, explicit
types on exports, `unknown` + narrowing at boundaries, no `console.log`). Comments
should explain *why* a non-obvious choice was made, not restate the code.

## Design language

A lexicographer's desk, not a cozy reading nook: laid paper, iron-gall ink, vermilion
rubrication. Instrument Serif for headwords, Newsreader for definitions (opsz axis
loaded on purpose), IBM Plex Mono for catalogue-card metadata. Entries are set as
real dictionary entries and the book's sentence appears as an attributed citation —
the move the OED makes when citing literature for a sense. Keep new UI inside this
language; don't introduce a second visual idiom.
