import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './Icons';

/**
 * Modal surface: a bottom sheet on phones, a centred dialog on desktop.
 *
 * Bottom sheets win on mobile because the controls land under your thumb rather
 * than at the top of a 6-inch screen.
 */

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** Optional line under the title — context, counts, hints. */
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Whether opening should put the caret in the first field.
   *
   * True for sheets that exist to be typed into. False for sheets you open to *read* —
   * focusing a field there scrolls the content you came for out of view and raises the
   * keyboard over the rest.
   */
  autoFocusField?: boolean;
}

export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  autoFocusField = true,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Escape to dismiss, and keep the page behind from scrolling under the sheet.
  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  /**
   * Move focus into the sheet, preferring the first *form field*.
   *
   * A naive "first focusable" query lands on the Close button, since it precedes
   * the content in DOM order — which swallows typing (a space activates it and
   * dismisses the sheet) and leaves the mobile keyboard shut on a sheet whose
   * whole purpose is typing.
   *
   * `autoFocusField={false}` skips the field entirely and focuses the panel, which
   * still moves focus into the dialog for screen readers and Escape.
   */
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const field = autoFocusField
      ? (panel.querySelector<HTMLElement>('[data-autofocus]') ??
        panel.querySelector<HTMLElement>(
          'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])',
        ))
      : null;

    (field ?? panel).focus();
  }, [open, autoFocusField]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-veil absolute inset-0 cursor-default bg-ink/35 backdrop-blur-[2px] dark:bg-black/60"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        // Focus target of last resort when a sheet has no form fields.
        tabIndex={-1}
        className="animate-sheet-up relative flex max-h-[88dvh] w-full flex-col border-rule bg-paper-raised shadow-2xl sm:max-w-lg sm:rounded-lg sm:border"
      >
        {/* Grab-handle affordance, phones only. */}
        <div className="flex justify-center pt-2.5 sm:hidden" aria-hidden>
          <div className="h-1 w-9 rounded-full bg-rule-strong" />
        </div>

        <header className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl leading-tight">{title}</h2>
            {subtitle && <p className="mt-0.5 text-sm text-ink-faint">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mt-1 -mr-2 flex h-11 w-11 shrink-0 items-center justify-center text-ink-faint transition-colors hover:text-ink"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        <hr className="rule-line" />

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

        {footer && (
          <>
            <hr className="rule-line" />
            <div className="px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
          </>
        )}
      </div>
    </div>
  );
}
