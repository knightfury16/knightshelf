import { useEffect, useState } from 'react';
import { useLibrary } from '../state/LibraryContext';
import {
  applyTheme,
  readThemeChoice,
  watchSystemTheme,
  type ThemeChoice,
} from '../state/theme';
import { MoonIcon, SunIcon, SettingsIcon } from '../components/Icons';

const THEME_OPTIONS: { value: ThemeChoice; label: string; Icon: (p: { className?: string }) => React.ReactNode }[] = [
  { value: 'light', label: 'Light', Icon: SunIcon },
  { value: 'dark', label: 'Dark', Icon: MoonIcon },
  { value: 'system', label: 'System', Icon: SettingsIcon },
];

export function SettingsView() {
  const { books, words, pendingCount } = useLibrary();
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice());

  // Keep following the OS while the choice is "system".
  useEffect(() => {
    if (choice !== 'system') return;
    return watchSystemTheme(() => applyTheme('system'));
  }, [choice]);

  function pickTheme(next: ThemeChoice): void {
    setChoice(next);
    applyTheme(next);
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
        <h2 className="label">Where your words live</h2>
        <p className="mt-2.5 leading-relaxed text-ink-soft">
          Right now, in this browser only — nothing has left this device. Install the app to your
          home screen and it works with no connection at all.
        </p>
        <p className="mt-3 leading-relaxed text-ink-soft">
          Syncing to a private GitHub repository comes next, so the same shelf opens on your phone
          and your computer. Excel export and import follow after that.
        </p>
        <div className="mt-4 border-l-2 border-rule pl-3.5">
          <p className="label !normal-case !tracking-normal">
            Until sync is wired up, treat this device as the only copy.
          </p>
        </div>
      </section>

      <hr className="rule-line" />

      <section className="py-7">
        <h2 className="label">About</h2>
        <p className="mt-2.5 leading-relaxed text-ink-soft">
          A commonplace book: the old practice of copying words and passages worth keeping into a
          notebook of your own. Every entry here cites the book you met the word in.
        </p>
      </section>
    </div>
  );
}
