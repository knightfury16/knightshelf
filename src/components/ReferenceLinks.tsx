import { useState, type MouseEvent } from 'react';
import { referenceLinks } from '../lib/references';

/**
 * A reference footnote, not a toolbar.
 *
 * Set as mono micro-caps so it reads like the "see also" line on a catalogue card and
 * stays subordinate to the entry itself.
 *
 * `beforeNavigate` exists because of a genuine data-loss bug: following one of these
 * links from a form holding an unsaved word meant coming back to an empty form, having
 * done the work for nothing. Where there is unsaved work, the link commits it first and
 * says so in its label — a link that silently saves would be worse than one that loses.
 */

interface ReferenceLinksProps {
  term: string;
  /** Drops the leading label where space is tight. */
  compact?: boolean;
  className?: string;
  /** Overrides the leading label, e.g. to signal that clicking also saves. */
  label?: string;
  /** Awaited before navigating. Use it to persist anything unsaved. */
  beforeNavigate?: () => Promise<void>;
}

export function ReferenceLinks({
  term,
  compact = false,
  className = '',
  label = 'See also',
  beforeNavigate,
}: ReferenceLinksProps) {
  const [busy, setBusy] = useState(false);

  if (!term.trim()) return null;

  const links = referenceLinks(term);

  async function handleClick(event: MouseEvent<HTMLAnchorElement>, href: string): Promise<void> {
    // With nothing to save, the plain link is the better behaviour: a new tab keeps
    // the app alive underneath.
    if (!beforeNavigate) return;

    event.preventDefault();
    if (busy) return;
    setBusy(true);

    try {
      await beforeNavigate();
    } finally {
      setBusy(false);
      /**
       * A popup opened after an await may fall outside the user-gesture window and be
       * blocked, so fall back to navigating this tab. Either route is safe now — the
       * word is already committed.
       */
      const opened = window.open(href, '_blank', 'noopener,noreferrer');
      if (!opened) window.location.href = href;
    }
  }

  return (
    <div className={`flex flex-wrap items-baseline gap-x-2 gap-y-1 ${className}`}>
      {!compact && <span className="label">{busy ? 'Saving…' : label}</span>}

      {links.map((link, index) => (
        <span key={link.label} className="flex items-baseline gap-2">
          {index > 0 && (
            <span aria-hidden className="label !tracking-normal text-ink-faint/50">
              ·
            </span>
          )}
          <a
            href={link.href}
            /**
             * In the installed PWA a same-tab navigation replaces the app shell with a
             * browser, and the way back is relaunching rather than going back.
             */
            target="_blank"
            rel="noreferrer noopener"
            aria-label={
              beforeNavigate ? `Save, then ${link.description.toLowerCase()}` : link.description
            }
            onClick={(event) => void handleClick(event, link.href)}
            // A full-strength underline: at 30% it was the only thing marking these as
            // links, and a faint rule in a desaturated accent is not a mark at all.
            className="label text-rubric underline decoration-rubric underline-offset-2 transition-opacity hover:opacity-70"
          >
            {link.label}
          </a>
        </span>
      ))}
    </div>
  );
}
