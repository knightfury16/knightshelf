/**
 * Following an outward link from a form holding unsaved work.
 *
 * The word has to be committed before leaving, or coming back finds an empty form — the
 * original data-loss bug this exists to prevent. That means awaiting a save in the middle
 * of a click, which is where it gets delicate:
 *
 * 1. A popup requested *after* an await can fall outside the transient-activation window
 *    and be blocked. So the tab is opened first, while the click is still live, and
 *    pointed at the URL afterwards.
 * 2. `window.open(href, '_blank', 'noopener')` cannot be used to detect blocking, because
 *    the spec has it **return null on success too** — "if noopener is true, then return
 *    null". Reading that result as failure meant the fallback fired on every click, so a
 *    new tab opened *and* the current tab navigated on top of it. Hence the handle from a
 *    plain open, with the opener severed by hand instead.
 *
 * Split out from the component so all three routes are testable without a browser, which
 * is exactly what the bug above needed and did not have.
 */

export interface ReferenceTab {
  navigate: (href: string) => void;
  close: () => void;
  isClosed: () => boolean;
}

export interface FollowReferenceIO {
  /** Opens a blank tab synchronously. Null when popups are blocked outright. */
  openBlankTab: () => ReferenceTab | null;
  /** Navigates the current tab — the last resort, since it replaces the app. */
  navigateHere: (href: string) => void;
}

export type FollowOutcome =
  | 'new-tab'
  /** Popups blocked, so the app was replaced. Safe only because the word is saved. */
  | 'same-tab'
  /** The save failed, so nothing was followed and the form still holds the word. */
  | 'abandoned';

export async function followReference(
  href: string,
  save: () => Promise<void>,
  io: FollowReferenceIO,
): Promise<FollowOutcome> {
  const tab = io.openBlankTab();

  try {
    await save();
  } catch {
    /**
     * Navigating now would lose the very thing the save was meant to protect, so the
     * link is abandoned and the form left standing with the word still in it. Doing
     * nothing looks odd, but it is the only option here that cannot lose work.
     */
    tab?.close();
    return 'abandoned';
  }

  if (tab && !tab.isClosed()) {
    tab.navigate(href);
    return 'new-tab';
  }

  io.navigateHere(href);
  return 'same-tab';
}

/** The real browser wiring. Kept beside the logic it serves, out of the component. */
export function browserReferenceIO(): FollowReferenceIO {
  return {
    openBlankTab: () => {
      const opened = window.open('', '_blank');
      if (!opened) return null;

      // `rel="noopener"` governs markup navigations, not scripted ones, so the
      // back-reference is cleared directly while the blank tab is still same-origin.
      opened.opener = null;

      return {
        // `replace`, so Back does not land the reader on a blank page.
        navigate: (href) => opened.location.replace(href),
        close: () => opened.close(),
        isClosed: () => opened.closed,
      };
    },
    navigateHere: (href) => {
      window.location.href = href;
    },
  };
}
