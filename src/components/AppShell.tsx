import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { SearchIcon, SettingsIcon, ShelfIcon } from './Icons';

/**
 * One nav component, repositioned by breakpoint: a thumb-reachable tab bar on
 * the phone, a top bar on desktop.
 */

interface TabDef {
  to: string;
  label: string;
  Icon: (props: { className?: string }) => ReactNode;
}

const TABS: TabDef[] = [
  { to: '/', label: 'Shelf', Icon: ShelfIcon },
  { to: '/search', label: 'Search', Icon: SearchIcon },
  { to: '/settings', label: 'Settings', Icon: SettingsIcon },
];

export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display leading-none tracking-tight ${className}`}>
      <span className="text-rubric">K</span>nightshelf
    </span>
  );
}

function NavBar() {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-paper-raised/95 px-safe backdrop-blur-sm md:bottom-auto md:top-0 md:border-t-0 md:border-b"
      aria-label="Main"
    >
      <div className="mx-auto flex max-w-4xl items-center md:h-16 md:gap-8 md:px-6">
        <Wordmark className="hidden text-2xl md:block" />

        <div className="flex flex-1 md:justify-end md:gap-1">
          {TABS.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  // 44px+ target, generous on a phone and unobtrusive on desktop.
                  'group relative flex flex-1 flex-col items-center gap-1 py-2.5 md:flex-none md:flex-row md:gap-2 md:px-3 md:py-2',
                  'min-h-11 transition-colors',
                  isActive ? 'text-rubric' : 'text-ink-faint hover:text-ink-soft',
                ].join(' ')
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-5 w-5" />
                  <span className="label !text-[0.625rem] !tracking-[0.12em] text-current md:!text-[0.6875rem]">
                    {label}
                  </span>
                  {/* A printer's rule marks the active tab, rather than a pill. */}
                  <span
                    aria-hidden
                    className={[
                      'absolute inset-x-4 top-0 h-px bg-rubric transition-opacity md:inset-x-2 md:top-auto md:bottom-0',
                      isActive ? 'opacity-100' : 'opacity-0',
                    ].join(' ')}
                  />
                </>
              )}
            </NavLink>
          ))}
        </div>
      </div>
      <div className="pb-safe md:hidden" />
    </nav>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();

  /**
   * Drilling into a book hides the tab bar. The lookup bar owns the bottom edge
   * there, and stacking two bars would swallow the screen once Gboard is open.
   */
  const showTabs = !pathname.startsWith('/book/');

  return (
    <div className="min-h-dvh">
      <div className="grain" aria-hidden />
      {showTabs && <NavBar />}
      <main
        className={
          showTabs
            ? 'pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pt-16 md:pb-0'
            : undefined
        }
      >
        {children}
      </main>
    </div>
  );
}
