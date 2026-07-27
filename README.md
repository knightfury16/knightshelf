# Knightshelf

**A commonplace book for words you meet while reading.**

Add the book you're reading, look up words as you hit them, and every word files
itself under that book — together with the sentence you found it in.

🔖 **[Try it](https://knightfury16.github.io/knightshelf/)** · installs to your phone's
home screen and works offline.

---

## Why

If you read physical books, looking up a word means reaching for your phone. A week
later that word is buried somewhere in your search history, mixed in with train times
and takeaway menus. And the question you actually want to ask — *what did this book
teach me?* — has no answer at all.

Knightshelf keeps the word, its meaning, and the sentence you met it in, filed under
the book that taught it to you.

## What it does

- **Add books by title.** Searches [Open Library](https://openlibrary.org) for the
  cover and author. Manual entry for anything it doesn't know.
- **Look a word up and keep it.** Definitions come from
  [dictionaryapi.dev](https://dictionaryapi.dev), with phonetics and audio
  pronunciation where available.
- **Pick the sense that fits.** Reading a nautical novel, a *sheet* is a rope — but
  the dictionary offers "bed cloth" first. You choose which sense your book meant.
- **Record the sentence.** Optional, and the most valuable field in the app: it's the
  one part you can never reconstruct later. Entries display it as a citation, the way
  a dictionary cites literature to illustrate a sense.
- **Two ways to read back.** *Entries* sets each word as a full dictionary entry.
  *Index* sets them as the index at the back of a book — dense columns, dot leaders
  out to the page number, meanings hidden until you ask. Reading down the index
  doubles as a recall test.
- **Search across everything**, including "I've met this word in another book too".
- **Works with no signal.** Look a word up on a train with no reception and it saves
  anyway; the definition fills itself in when you're back online.
- **Installable.** Add to home screen and it opens like a native app, offline, with
  the status bar tinted to match the page.

## Your data stays on your device

There is no account, no server, and no analytics. Nothing you type leaves the browser
it was typed into. Books and words live in IndexedDB; cached definitions, covers and
fonts live in the service worker cache.

Two consequences worth understanding before you invest real reading into it:

- **Storage is per-device.** Your phone and your laptop each keep their own separate
  shelf. Syncing them is the next thing being built (see Roadmap).
- **There is no backup yet.** Clearing site data — or uninstalling the app on Android
  — takes your words with it. Export is on the roadmap; until then, treat one device
  as the only copy.

## Status and roadmap

Early but genuinely usable. It is a personal project, built for one reader's habits.

- [x] Books, word capture, dictionary lookup, both reading views, search, offline, PWA
- [ ] **Sync** — push to a *private* GitHub repository so the same shelf opens on
      every device, using a token you create and scope yourself
- [ ] **Excel export and import** — one sheet per book, so your words are yours to
      take elsewhere
- [ ] Nice-to-haves: richer statistics, bulk editing

## Run it locally

Requires Node 20+.

```bash
git clone https://github.com/knightfury16/knightshelf.git
cd knightshelf
npm install
npm run dev
```

| Command | |
|---|---|
| `npm run dev` | dev server on port 5173 |
| `npm run build` | production build into `dist/` |
| `npm run preview` | serve the production build |
| `npm run typecheck` | TypeScript, no emit |
| `npm run lint` | oxlint |
| `npm run icons` | regenerate the PWA icon set |

## Host your own copy

The app is entirely static, so GitHub Pages hosts it for free.

1. Fork this repository.
2. In `vite.config.ts`, set `base` to match your repository name — it is
   `'/knightshelf/'` here, and it must agree or every asset will 404.
3. In your fork: **Settings → Pages → Build and deployment → Source → GitHub Actions**.
4. Push to `main`. The included workflow builds and publishes on every push.

## Built with

React 19, TypeScript, Vite, Tailwind CSS 4, and `idb` for IndexedDB. No backend, no
state management library, no component library.

Both data sources are deliberately **keyless**. A static site publishes its
JavaScript, so any API key would be public too — which rules out every dictionary API
that requires one, and is why this app can be hosted by anyone for nothing.

## A note on the design

The visual language is a lexicographer's working desk rather than a reading app: laid
paper, iron-gall ink, and vermilion accents, after the scribal habit of setting
headings in red. [Instrument Serif](https://fonts.google.com/specimen/Instrument+Serif)
sets the headwords, [Newsreader](https://fonts.google.com/specimen/Newsreader) the
definitions — chosen for its optical-size axis, so letterforms firm up at small sizes
and refine at display sizes — and
[IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) the metadata, like a
library catalogue card. The paper grain is generated SVG noise, so it costs no request
and never blurs.

## Contributing

Issues and pull requests are welcome. `CLAUDE.md` documents the constraints that are
load-bearing rather than incidental — why routing must stay hash-based, why fonts are
deliberately not precached, why deletes are soft — so it's worth a read before
changing anything structural.

## Credits

- [dictionaryapi.dev](https://dictionaryapi.dev) — free, keyless dictionary data
- [Open Library](https://openlibrary.org) — book metadata and cover art
- Instrument Serif, Newsreader, and IBM Plex Mono, all under the SIL Open Font License

The idea is much older than the software: a *commonplace book* is the centuries-old
practice of copying passages and words worth keeping into a notebook of your own.
