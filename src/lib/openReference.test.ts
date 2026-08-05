import { describe, expect, it, vi } from 'vitest';
import { followReference, type FollowReferenceIO, type ReferenceTab } from './openReference';

const HREF = 'https://www.google.com/search?q=define+gunwale';

function fakeTab(over: Partial<ReferenceTab> = {}) {
  const navigate = vi.fn<(href: string) => void>();
  const close = vi.fn();
  let closed = false;

  const tab: ReferenceTab = {
    navigate,
    close: () => {
      closed = true;
      close();
    },
    isClosed: () => closed,
    ...over,
  };

  return { tab, navigate, close };
}

function harness(options: { tab?: ReferenceTab | null } = {}) {
  const navigateHere = vi.fn<(href: string) => void>();
  const io: FollowReferenceIO = {
    openBlankTab: () => (options.tab === undefined ? null : options.tab),
    navigateHere,
  };
  return { io, navigateHere };
}

describe('followReference', () => {
  it('saves first, then points the tab it already opened at the link', async () => {
    const order: string[] = [];
    const { tab, navigate } = fakeTab();
    const h = harness({ tab });

    const outcome = await followReference(
      HREF,
      async () => {
        order.push('save');
      },
      {
        openBlankTab: () => {
          order.push('open');
          return tab;
        },
        navigateHere: h.navigateHere,
      },
    );

    expect(outcome).toBe('new-tab');
    // The tab must be opened while the click is still live, before anything is awaited.
    expect(order).toEqual(['open', 'save']);
    expect(navigate).toHaveBeenCalledWith(HREF);
  });

  /**
   * The bug this file exists for. `window.open(..., 'noopener')` returns null on success,
   * so the old code read every success as a failure and navigated the current tab on top
   * of the tab it had just opened — two tabs from one click.
   */
  it('never navigates the current tab when a new one was obtained', async () => {
    const { tab } = fakeTab();
    const h = harness({ tab });

    await followReference(HREF, async () => undefined, h.io);

    expect(h.navigateHere).not.toHaveBeenCalled();
  });

  it('falls back to this tab only when no tab could be opened', async () => {
    const h = harness({ tab: null });

    const outcome = await followReference(HREF, async () => undefined, h.io);

    expect(outcome).toBe('same-tab');
    expect(h.navigateHere).toHaveBeenCalledWith(HREF);
  });

  it('falls back when the reader closed the blank tab while the save ran', async () => {
    const { tab } = fakeTab();
    const h = harness({ tab });

    const outcome = await followReference(
      HREF,
      async () => {
        tab.close();
      },
      h.io,
    );

    expect(outcome).toBe('same-tab');
    expect(h.navigateHere).toHaveBeenCalledWith(HREF);
  });

  /**
   * Navigating after a failed save would lose the word, which is the whole thing this
   * guards. Better to do nothing and leave the form standing.
   */
  it('abandons the link and closes the tab when the save fails', async () => {
    const { tab, navigate, close } = fakeTab();
    const h = harness({ tab });

    const outcome = await followReference(
      HREF,
      async () => {
        throw new Error('storage is full');
      },
      h.io,
    );

    expect(outcome).toBe('abandoned');
    expect(close).toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    expect(h.navigateHere).not.toHaveBeenCalled();
  });

  it('does not rethrow a failed save', async () => {
    const h = harness({ tab: null });

    await expect(
      followReference(HREF, async () => {
        throw new Error('storage is full');
      }, h.io),
    ).resolves.toBe('abandoned');
  });

  it('abandons cleanly even when popups were blocked as well', async () => {
    const h = harness({ tab: null });

    const outcome = await followReference(HREF, async () => {
      throw new Error('storage is full');
    }, h.io);

    expect(outcome).toBe('abandoned');
    expect(h.navigateHere).not.toHaveBeenCalled();
  });
});
