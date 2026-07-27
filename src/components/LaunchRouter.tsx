import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibrary } from '../state/LibraryContext';
import { currentlyReadingBook } from '../lib/stats';

/**
 * On a cold launch, open the book you're currently reading rather than the shelf.
 *
 * The common case is picking the phone up mid-chapter to look something up, so the
 * shelf is a detour. Runs exactly once per page load, and only when the app opened
 * at the root — so tapping the Shelf tab afterwards behaves normally, and a
 * restored deep link (from the installed PWA) is left alone.
 *
 * Finished books are excluded by `currentlyReadingBook`: those you visit
 * deliberately, to see what you learned.
 */
export function LaunchRouter() {
  const { books, words, status } = useLibrary();
  const navigate = useNavigate();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current || status !== 'ready') return;
    handled.current = true;

    const atRoot = window.location.hash === '' || window.location.hash === '#/';
    if (!atRoot) return;

    const current = currentlyReadingBook(books, words);
    // `replace` so the back gesture goes to the shelf rather than looping here.
    if (current) navigate(`/book/${current.id}`, { replace: true });
  }, [status, books, words, navigate]);

  return null;
}
