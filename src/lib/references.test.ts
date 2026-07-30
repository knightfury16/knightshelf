import { describe, expect, it } from 'vitest';
import { referenceLinks } from './references';

const hrefFor = (term: string, label: string): string =>
  referenceLinks(term).find((link) => link.label === label)!.href;

describe('referenceLinks', () => {
  it('offers Google, Merriam-Webster and images', () => {
    expect(referenceLinks('gunwale').map((link) => link.label)).toEqual([
      'Google',
      'M-W',
      'Images',
    ]);
  });

  it('asks Google to define, so the dictionary card appears', () => {
    // A bare query returns ordinary results without the usage examples.
    expect(hrefFor('gunwale', 'Google')).toBe('https://www.google.com/search?q=define+gunwale');
  });

  it('requests the image tab explicitly', () => {
    expect(hrefFor('escarpment', 'Images')).toContain('tbm=isch');
  });

  it('lowercases and hyphenates the Merriam-Webster path', () => {
    // Their URLs are lowercase, and multi-word entries are hyphenated.
    expect(hrefFor('Sagacity', 'M-W')).toBe('https://www.merriam-webster.com/dictionary/sagacity');
    expect(hrefFor('a priori', 'M-W')).toBe('https://www.merriam-webster.com/dictionary/a-priori');
  });

  it('trims stray whitespace before building a URL', () => {
    expect(hrefFor('  penance  ', 'M-W')).toBe(
      'https://www.merriam-webster.com/dictionary/penance',
    );
    expect(hrefFor('  penance  ', 'Google')).toBe(
      'https://www.google.com/search?q=define+penance',
    );
  });

  it('encodes characters that would otherwise break the URL', () => {
    for (const link of referenceLinks("cat's paw & more")) {
      expect(link.href).not.toMatch(/\s/);
      // Unencoded ampersands would silently truncate the query.
      expect(link.href.split('?')[1] ?? '').not.toContain('& ');
      expect(() => new URL(link.href)).not.toThrow();
    }
  });

  it('always produces absolute https URLs', () => {
    for (const link of referenceLinks('brindle')) {
      expect(new URL(link.href).protocol).toBe('https:');
    }
  });

  it('names the word in each accessible description', () => {
    for (const link of referenceLinks('petrichor')) {
      expect(link.description).toContain('petrichor');
    }
  });
});
