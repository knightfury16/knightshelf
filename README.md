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
  *Index* lists the words alone, with dot leaders out to the page number and meanings
  hidden until you ask — so reading down it doubles as a recall test.
- **Search across everything**, including "I've met this word in another book too".
- **Works with no signal.** Look a word up on a train with no reception and it saves
  anyway; the definition fills itself in when you're back online.
- **Sync across devices** through a private GitHub repository you own. See below.
- **Export to Excel**, one sheet per book, so your words are always yours to take
  elsewhere.

## Install it on your phone

This is where the app is meant to live. Installed, it opens from your home screen like
a native app, runs offline, and tints the status bar to match the page.

**Android (Chrome)**

1. Open <https://knightfury16.github.io/knightshelf/> in Chrome.
2. Tap the **⋮** menu.
3. Choose **Add to Home screen** (it may say **Install app**), then confirm.

**iPhone (Safari)**

1. Open the same link in Safari — Chrome on iOS cannot install web apps.
2. Tap the **Share** button.
3. Choose **Add to Home Screen**.

Installing also makes Chrome far more likely to grant *persistent storage*, which
exempts your words from being cleared when the device runs low on space. You can check
that under **Settings → Storage** in the app.

## Set up sync

Optional. Without it the app works perfectly well on one device. With it, the same
shelf opens everywhere.

Your words live in a **private repository that you create and own**. There is no
account to make and no server in between — the app talks directly to GitHub using a
token you generate and scope yourself.

**Once, to get started**

1. **Create an empty private repository**, for example `knightshelf-data`. Don't add a
   README or any files; the app creates what it needs.
2. **Generate a
   [fine-grained token](https://github.com/settings/personal-access-tokens/new).** The
   settings that matter:
   - **Repository access** → **Only select repositories** → pick that one repository.
   - **Permissions → Contents** → **Read and write**.
   - `Metadata: Read-only` is added automatically and is required. Nothing else is.
3. **Copy the token** — GitHub shows it once.
4. In the app: **Settings → Sync → Set up sync**, enter `your-name/knightshelf-data`
   and paste the token, then **Connect**.

**On every other device**, repeat step 4 with the same repository. The first sync pulls
what's already there and merges it with whatever is on that device.

**After that it looks after itself.** It pulls when you open the app, pushes a few
seconds after you stop editing, and retries when a connection returns. Two devices that
were both edited offline merge automatically — words are combined, and the most recent
edit wins on anything touched in both places.

A quiet bonus: every sync is a git commit, so the repository's history becomes a dated
record of your reading. Browsing it shows what you learned, and when.

**Worth knowing**

- The token is stored in that browser only, and sent only to GitHub. It is never
  written into the repository. Each device needs its own paste.
- Because it is scoped to one repository with contents-only access, a leaked token
  exposes your word list and nothing else. Revoking it on GitHub kills it everywhere.
- **Keep the repository private.** The app warns you in Settings if it isn't.
- Sync currently handles libraries up to roughly 1,250 words. Past that it says so
  plainly rather than failing quietly.

## Your data

There is no account, no analytics, and no third-party service. Words live in your
browser's IndexedDB, plus your own private repository if you enable sync.

Two things to keep in mind:

- **Without sync, each device keeps its own separate shelf.** Nothing is shared until
  you connect them.
- **Export is your backup.** Settings → Export writes an Excel workbook with one sheet
  per book. Worth doing after a good reading session.

## Status and roadmap

Usable daily. It's a personal project, built around one reader's habits.

- [x] Books, word capture, dictionary lookup, both reading views, search, offline, PWA
- [x] Excel export — one sheet per book
- [x] Sync through a private GitHub repository
- [ ] **Excel import**, so an export can be restored rather than only kept
- [ ] Larger libraries — sync needs the Git Data API to pass the ~1,250 word ceiling
- [ ] ISBN capture, richer statistics

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
| `npm test` | unit tests |
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

Hosting your own copy is also the privacy-conscious choice if you plan to use sync: a
browser app handling a token is only as trustworthy as the JavaScript serving it, and
forking removes anyone else from that equation.

## Built with

React 19, TypeScript, Vite, Tailwind CSS 4, `idb` for IndexedDB, and
`write-excel-file` for the export. No backend, no state management library, no
component library.

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
deliberately not precached, why deletes are soft — and `HANDOFF.md` records the
invariants the sync merge depends on. Both are worth reading before changing anything
structural.

## Credits

- [dictionaryapi.dev](https://dictionaryapi.dev) — free, keyless dictionary data
- [Open Library](https://openlibrary.org) — book metadata and cover art
- Instrument Serif, Newsreader, and IBM Plex Mono, all under the SIL Open Font License

The idea is much older than the software: a *commonplace book* is the centuries-old
practice of copying passages and words worth keeping into a notebook of your own.
