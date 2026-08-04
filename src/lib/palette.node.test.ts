import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The palette has to stay usable on a greyscale display.
 *
 * Android's Bedtime mode desaturates the whole screen, and it cannot be detected from
 * CSS — there is no media query for it, and `forced-colors` is a different thing
 * entirely. So the app can't switch palettes when it happens; the one palette has to
 * work either way.
 *
 * These tests measure the cues the interface actually leans on, in luma — the
 * green-weighted average a desaturating display collapses colour to. They deliberately
 * do *not* assert that `--rubric` separates from the text greys: a red accent scores
 * low in luma because green carries most of the weight, and no tuning fixes that while
 * the accent stays red. That limit is exactly why pressed and selected states invert to
 * a filled slug instead of merely taking the accent colour. What is asserted here is
 * that those fills, and the surfaces behind selected rows, remain legible.
 *
 * Named `.node.test.ts` because it reads the stylesheet off disk. That suffix is compiled
 * by tsconfig.node.json rather than tsconfig.app.json, which keeps node's globals out of
 * scope for the app itself — `process.env` should not typecheck inside a static site.
 * (`index.css?raw` would avoid the import, but Vite's stylesheet pipeline claims the
 * request first and hands back an empty string.)
 */

const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

/** Rec.709 luma, 0–255. The weights a saturation matrix uses to collapse colour. */
function luma(hex: string): number {
  const value = hex.trim().replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;

  const red = parseInt(full.slice(0, 2), 16);
  const green = parseInt(full.slice(2, 4), 16);
  const blue = parseInt(full.slice(4, 6), 16);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Pulls the custom properties out of one selector's block. */
function readTokens(selector: string): Record<string, string> {
  const pattern = new RegExp(`^${selector}\\s*\\{([^}]*)\\}`, 'm');
  const block = pattern.exec(CSS);
  if (!block) throw new Error(`No ${selector} block found in index.css.`);

  const tokens: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    tokens[name] = value.trim();
  }
  return tokens;
}

const MODES = {
  light: readTokens(':root'),
  dark: readTokens('\\.dark'),
} as const;

describe('palette tokens', () => {
  it('defines the light palette', () => {
    expect(Object.keys(MODES.light).length).toBeGreaterThan(8);
  });

  /**
   * A token added to one mode and forgotten in the other inherits the wrong value
   * rather than failing loudly, which is close to impossible to spot by eye.
   */
  it('defines the same tokens in both modes', () => {
    expect(Object.keys(MODES.dark).sort()).toEqual(Object.keys(MODES.light).sort());
  });
});

describe.each(['light', 'dark'] as const)('%s mode, desaturated', (mode) => {
  const tokens = MODES[mode];
  const at = (name: string): number => {
    const value = tokens[name];
    if (!value?.startsWith('#')) throw new Error(`--${name} is not a hex colour in ${mode}.`);
    return luma(value);
  };

  /**
   * Every pressed control, selected segment and destructive button is now a block of
   * `--rubric` carrying `--paper-raised` text. That inversion is what survives
   * desaturation, so the two have to stay far apart.
   */
  it('keeps filled accent slugs legible', () => {
    expect(Math.abs(at('rubric') - at('paper-raised'))).toBeGreaterThanOrEqual(90);
  });

  /**
   * The chosen sense sits on `--rubric-tint`. It used to land 16 luma from the surface
   * in light mode and 2 in dark, so the choice was invisible without hue — and in light
   * mode the tint was lighter than `--paper-sunk`, making a selected row read as *less*
   * prominent than a plain panel.
   */
  it('makes a selected row a different surface', () => {
    expect(Math.abs(at('rubric-tint') - at('paper-raised'))).toBeGreaterThanOrEqual(20);
  });

  /** The other cue those rows use: full-strength ink against faint. */
  it('keeps the ink-to-faint step wide', () => {
    expect(Math.abs(at('ink') - at('ink-faint'))).toBeGreaterThanOrEqual(80);
  });

  /**
   * `--rubric-tint` has to move away from the page in the direction that reads as a
   * change of surface: recessed on paper, raised in the dark.
   */
  it('moves the selected surface away from the page', () => {
    const tint = at('rubric-tint');
    const paper = at('paper-raised');
    expect(mode === 'light' ? tint < paper : tint > paper).toBe(true);
  });
});
