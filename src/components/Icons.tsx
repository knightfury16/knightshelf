/**
 * Hand-drawn hairline icons.
 *
 * An icon set is a typeface decision as much as a drawing one: these match the
 * 1.25px rules used throughout, so nothing looks bolted on from another library.
 */

interface IconProps {
  className?: string;
}

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.25,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Books standing at uneven heights on a shelf — the app's own metaphor. */
export function ShelfIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 20h16" />
      <rect x="5.5" y="7" width="3.5" height="10" rx="0.5" />
      <rect x="10.5" y="4.5" width="3.5" height="12.5" rx="0.5" />
      <path d="M16.4 6.6l2.9.8-2.2 9.2-2.9-.8z" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l4.5 4.5" />
    </svg>
  );
}

/** Sliders rather than a cog: apparatus, not machinery. */
export function SettingsIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 8h10M18 8h2M4 16h4M12 16h8" />
      <circle cx="16" cy="8" r="2" />
      <circle cx="10" cy="16" r="2" />
    </svg>
  );
}

export function BackIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M14.5 5.5L8 12l6.5 6.5" />
    </svg>
  );
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </svg>
  );
}

export function SpeakerIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 9.5h3L11 6v12l-4-3.5H4z" />
      <path d="M14.5 9.5a3.5 3.5 0 010 5M17 7a7 7 0 010 10" />
    </svg>
  );
}

export function StarIcon({ className, filled }: IconProps & { filled?: boolean }) {
  return (
    <svg {...base} className={className} fill={filled ? 'currentColor' : 'none'}>
      <path d="M12 4.5l2.3 4.9 5.2.7-3.8 3.6 1 5.3-4.7-2.6-4.7 2.6 1-5.3L4.5 10l5.2-.7z" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 7.5h14M9.5 7.5V5.5h5v2M7 7.5l.8 11.5h8.4L17 7.5" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4.5 19.5l1-4L16 5a1.8 1.8 0 012.5 2.5L8 18z" />
      <path d="M14.5 6.5L17 9" />
    </svg>
  );
}

/** Circular arrow, for asking the dictionary again. */
export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M19 12a7 7 0 11-2.05-4.95" />
      <path d="M19.5 4.5V8h-3.5" />
    </svg>
  );
}

export function SunIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4" />
    </svg>
  );
}

export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />
    </svg>
  );
}
