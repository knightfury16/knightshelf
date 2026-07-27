import { useEffect, useState } from 'react';

/**
 * Delays a value so effects keyed on it don't fire on every keystroke.
 * Used for both dictionary lookups and book search.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}

/**
 * State that outlives the session, for view preferences.
 *
 * Someone who prefers the compact index almost certainly prefers it for every
 * book, not just the one they happened to toggle it on.
 */
export function usePersistedState<T extends string>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback;
    } catch {
      return fallback;
    }
  });

  function update(next: T): void {
    setValue(next);
    try {
      localStorage.setItem(key, next);
    } catch {
      // Storage blocked; the choice still holds for this session.
    }
  }

  return [value, update];
}

/** Tracks connectivity so the UI can say why a lookup was queued rather than failing silently. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
