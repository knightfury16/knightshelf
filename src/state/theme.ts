/**
 * Theme resolution.
 *
 * The class is applied by an inline script in index.html before first paint;
 * this module keeps it in sync afterwards and persists the choice. The storage
 * key must match the one that script reads.
 */

export type ThemeChoice = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'knightshelf.theme';

/** Must match --paper in index.css, so the status bar blends into the page. */
const STATUS_BAR: Record<ResolvedTheme, string> = {
  light: '#f2eee4',
  dark: '#14120f',
};

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readThemeChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Storage blocked (private mode); fall back to following the system.
  }
  return 'system';
}

export function resolveTheme(choice: ThemeChoice): ResolvedTheme {
  if (choice === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return choice;
}

export function applyTheme(choice: ThemeChoice): ResolvedTheme {
  const resolved = resolveTheme(choice);

  document.documentElement.classList.toggle('dark', resolved === 'dark');
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', STATUS_BAR[resolved]);

  try {
    if (choice === 'system') localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
  } catch {
    // Non-fatal: the theme still applies for this session.
  }

  return resolved;
}

/** Follows the OS while the choice is `system`. Returns an unsubscribe function. */
export function watchSystemTheme(onChange: () => void): () => void {
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
