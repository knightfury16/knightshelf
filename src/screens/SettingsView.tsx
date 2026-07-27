import { useCallback, useEffect, useState } from 'react';
import { useLibrary } from '../state/LibraryContext';
import {
  applyTheme,
  readThemeChoice,
  watchSystemTheme,
  type ThemeChoice,
} from '../state/theme';
import { readStorageStatus, requestPersistentStorage, type StorageStatus } from '../lib/persist';
import { buildXlsxBlob, downloadBlob, exportFileName } from '../lib/excel';
import { MoonIcon, SettingsIcon, SunIcon } from '../components/Icons';

const THEME_OPTIONS: {
  value: ThemeChoice;
  label: string;
  Icon: (p: { className?: string }) => React.ReactNode;
}[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: SettingsIcon },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/**
 * Roughly what the words themselves occupy.
 *
 * Reported separately from the origin total because the two differ by orders of
 * magnitude: Chrome pads opaque cross-origin cache entries heavily, so the origin
 * figure can read tens of megabytes for a library of a few kilobytes. Showing only
 * the total implies the words are enormous, which they aren't.
 */
function librarySizeBytes(books: unknown[], words: unknown[]): number {
  return new TextEncoder().encode(JSON.stringify({ books, words })).length;
}

/**
 * Chrome answers the persistence request silently — there is no permission prompt to
 * accept or dismiss — so a refusal is indistinguishable from a broken button unless
 * the outcome is reported explicitly.
 */
type PersistOutcome = 'idle' | 'asking' | 'granted' | 'declined';

export function SettingsView() {
  const { books, words, pendingCount } = useLibrary();

  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice());
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [persistOutcome, setPersistOutcome] = useState<PersistOutcome>('idle');

  useEffect(() => {
    if (choice !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [choice]);

  const refreshStorage = useCallback(() => {
    void readStorageStatus().then(setStorage);
  }, []);

  useEffect(refreshStorage, [refreshStorage]);

  function pickTheme(next: ThemeChoice): void {
    setChoice(next);
    applyTheme(next);
  }

  async function protectStorage(): Promise<void> {
    if (persistOutcome === 'asking') return;
    setPersistOutcome('asking');

    const granted = await requestPersistentStorage();
    // Read the status back rather than trusting the return value alone.
    const next = await readStorageStatus();
    setStorage(next);
    setPersistOutcome(granted || next.persisted ? 'granted' : 'declined');
  }

  async function exportToExcel(): Promise<void> {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const blob = await buildXlsxBlob(books, words);
      downloadBlob(blob, exportFileName(new Date()));
    } catch (error: unknown) {
      setExportError(
        error instanceof Error ? error.message : 'The export could not be created.',
      );
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6">
      <header className="pt-8 pb-4 sm:pt-10">
        <h1 className="font-display text-4xl leading-none">Settings</h1>
        <p className="label mt-2.5">
          {books.length} {books.length === 1 ? 'book' : 'books'} · {words.length}{' '}
          {words.length === 1 ? 'word' : 'words'}
          {pendingCount > 0 ? ` · ${pendingCount} awaiting definition` : ''}
        </p>
      </header>

      <hr className="rule-line" />

      <section className="py-7">
        <h2 className="label">Appearance</h2>
        <div className="mt-3 flex gap-2">
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => pickTheme(value)}
              aria-pressed={choice === value}
              className={`flex min-h-11 flex-1 items-center justify-center gap-2 border transition-colors ${
                choice === value
                  ? 'border-rubric text-rubric'
                  : 'border-rule text-ink-soft hover:border-rule-strong'
              }`}
            >
              <Icon className="h-4 w-4" />
              <span className="label text-current">{label}</span>
            </button>
          ))}
        </div>
      </section>

      <hr className="rule-line" />

      <section className="py-7">
        <h2 className="label">Export</h2>
        <p className="mt-2.5 leading-relaxed text-ink-soft">
          An Excel workbook with one sheet per book, plus a{' '}
          <span className="font-mono text-[0.8em]">_Books</span> sheet holding the titles and
          authors. Until syncing exists, this is your only backup — worth doing after a good
          reading session.
        </p>

        <button
          type="button"
          onClick={() => void exportToExcel()}
          disabled={exporting || words.length === 0}
          className="mt-4 min-h-11 w-full bg-rubric px-4 text-paper-raised transition-opacity disabled:opacity-40 sm:w-auto sm:px-6"
        >
          {exporting ? 'Building the workbook…' : 'Export to Excel'}
        </button>

        {words.length === 0 && (
          <p className="label mt-2 !normal-case !tracking-normal">
            Nothing to export yet.
          </p>
        )}

        {exportError && (
          <p className="mt-3 border-l-2 border-rubric bg-rubric-tint px-3.5 py-2.5 text-sm">
            {exportError}
          </p>
        )}
      </section>

      <hr className="rule-line" />

      <section className="py-7">
        <h2 className="label">Storage</h2>

        {storage && !storage.supported && (
          <p className="mt-2.5 leading-relaxed text-ink-soft">
            This browser doesn't report storage status. Your words are saved locally, but
            export regularly to be safe.
          </p>
        )}

        {storage?.supported && (
          <>
            <p className="mt-2.5 leading-relaxed text-ink-soft">
              {storage.persisted ? (
                <>
                  <span className="text-rubric">Protected.</span> This browser won't clear your
                  words to reclaim space.
                </>
              ) : (
                <>
                  <span className="text-rubric">Best effort.</span> The browser is allowed to
                  clear your words if the device runs low on space. Asking for protection is
                  worth doing now.
                </>
              )}
            </p>

            <dl className="mt-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <dt className="label">Your words</dt>
                <dd className="font-mono text-sm">{formatBytes(librarySizeBytes(books, words))}</dd>
              </div>

              {storage.usageBytes !== undefined && storage.quotaBytes !== undefined && (
                <div className="flex items-baseline gap-2">
                  <dt className="label">All site data</dt>
                  <dd className="font-mono text-sm">
                    {formatBytes(storage.usageBytes)} of {formatBytes(storage.quotaBytes)}
                  </dd>
                </div>
              )}
            </dl>

            <p className="mt-2 text-sm text-ink-faint">
              The larger figure counts the app itself, fonts, and cached images — and the
              browser inflates cross-origin entries on purpose, so it reads far higher than
              the bytes actually stored. Your words are the number that matters.
            </p>

            {!storage.persisted && (
              <button
                type="button"
                onClick={() => void protectStorage()}
                disabled={persistOutcome === 'asking'}
                className="mt-4 min-h-11 border border-rule px-4 transition-colors hover:border-rubric hover:text-rubric disabled:opacity-50"
              >
                <span className="label text-current">
                  {persistOutcome === 'asking'
                    ? 'Asking the browser…'
                    : persistOutcome === 'declined'
                      ? 'Ask again'
                      : 'Request protection'}
                </span>
              </button>
            )}

            {persistOutcome === 'granted' && (
              <p className="animate-bleed mt-3 border-l-2 border-rubric pl-3.5 text-sm text-ink-soft">
                Granted. Your words are now exempt from automatic cleanup.
              </p>
            )}

            {persistOutcome === 'declined' && (
              <div className="animate-bleed mt-3 border-l-2 border-rule pl-3.5 text-sm text-ink-soft">
                <p>
                  The browser declined. That's its decision rather than an error — there's no
                  prompt to accept, and nothing is broken.
                </p>
                <p className="mt-1.5">
                  It generally grants protection once the app is installed to your home screen
                  and used a few times, so it's worth asking again later. Your words are saved
                  either way; this only governs whether the browser may clear them to reclaim
                  space.
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <hr className="rule-line" />

      <section className="py-7">
        <h2 className="label">Where your words live</h2>
        <p className="mt-2.5 leading-relaxed text-ink-soft">
          In this browser only — nothing has left this device, and there is no account or
          server. Each device keeps its own separate shelf.
        </p>
        <p className="mt-3 leading-relaxed text-ink-soft">
          Syncing to a private GitHub repository is planned next, so one shelf follows you
          everywhere.
        </p>
      </section>

      <hr className="rule-line" />

      <section className="py-7">
        <h2 className="label">About</h2>
        <p className="mt-2.5 leading-relaxed text-ink-soft">
          A commonplace book: the old practice of copying words and passages worth keeping
          into a notebook of your own. Every entry here cites the book you met the word in.
        </p>
      </section>
    </div>
  );
}
