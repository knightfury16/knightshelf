import { useState } from 'react';
import { bucket } from '../lib/hash';

/**
 * A book as an object rather than a thumbnail.
 *
 * Two deliberate touches: proportions vary slightly per book, and books without
 * cover art get a typeset cloth binding instead of a grey placeholder. Both are
 * derived from the id, so they're stable across renders and across devices.
 */

/** Real books aren't one shape. Width-to-height ratios, all plausible trim sizes. */
const RATIOS = [0.66, 0.62, 0.69, 0.64, 0.6];

/**
 * Cloth binding colours for coverless books. Fixed rather than theme-derived —
 * a book's binding doesn't change colour when you turn the lights off.
 */
const CLOTHS = ['#6b4a42', '#42544c', '#5b4a36', '#3f4c58', '#5d4550'];

interface BookCoverProps {
  id: string;
  title: string;
  author?: string;
  coverUrl?: string;
  className?: string;
}

export function BookCover({ id, title, author, coverUrl, className = '' }: BookCoverProps) {
  const ratio = RATIOS[bucket(id, RATIOS.length)];
  const cloth = CLOTHS[bucket(`${id}cloth`, CLOTHS.length)];

  /**
   * Covers are not held in the service worker cache, so offline they may simply fail
   * to load. Falling back to the typeset binding keeps the shelf looking deliberate
   * rather than showing a row of broken-image icons.
   */
  const [imageFailed, setImageFailed] = useState(false);
  const showArtwork = Boolean(coverUrl) && !imageFailed;

  return (
    <div
      className={`relative w-full overflow-hidden rounded-[2px] shadow-book ${className}`}
      style={{ aspectRatio: ratio }}
    >
      {showArtwork ? (
        <img
          src={coverUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setImageFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full flex-col justify-between p-2.5"
          style={{ backgroundColor: cloth }}
        >
          <div className="h-px w-full bg-white/25" />
          <div className="min-h-0">
            <p className="font-display line-clamp-4 text-[0.9rem] leading-[1.15] text-[#ede6d9]">
              {title}
            </p>
            {author && (
              <p className="mt-1.5 truncate font-mono text-[0.5rem] tracking-[0.1em] text-[#ede6d9]/60 uppercase">
                {author}
              </p>
            )}
          </div>
          <div className="h-px w-full bg-white/15" />
        </div>
      )}

      {/* Spine shading and a page-edge highlight: enough to read as a physical object. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(90deg, rgb(0 0 0 / 0.28) 0%, rgb(0 0 0 / 0.06) 5%, rgb(0 0 0 / 0) 12%, rgb(0 0 0 / 0) 94%, rgb(255 255 255 / 0.14) 100%)',
        }}
      />
    </div>
  );
}
