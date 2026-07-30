/**
 * Outward links for a word.
 *
 * The app archives; these reference the rest of the world. Keyless dictionary APIs
 * carry almost no example sentences for literary vocabulary — measured at 1 word in 14
 * across a real reading list — and better dictionaries either need a key a static site
 * cannot hide, or licence terms that forbid bundling their content.
 *
 * Linking has neither problem. Nothing is copied, nothing needs maintaining, and the
 * division of labour is the right one: this app remembers *which book* taught you the
 * word, which is the part no search engine can do.
 */

export interface ReferenceLink {
  /** Short label for the mono reference line. */
  label: string;
  href: string;
  /** Fuller description, used as the accessible label. */
  description: string;
}

/** Merriam-Webster paths are lowercase and hyphenated for multi-word entries. */
function merriamSlug(term: string): string {
  return encodeURIComponent(term.trim().toLowerCase().replace(/\s+/g, '-'));
}

export function referenceLinks(term: string): ReferenceLink[] {
  const query = encodeURIComponent(term.trim());

  return [
    {
      label: 'Google',
      // "define" reliably surfaces the dictionary card, with its usage examples,
      // rather than a page of ordinary results.
      href: `https://www.google.com/search?q=define+${query}`,
      description: `Look up ${term} on Google`,
    },
    {
      label: 'M-W',
      // Merriam-Webster's own content cannot be bundled, but linking to the editorial
      // example sentences it does have is entirely fine.
      href: `https://www.merriam-webster.com/dictionary/${merriamSlug(term)}`,
      description: `Look up ${term} in Merriam-Webster`,
    },
    {
      label: 'Images',
      // Unexpectedly the strongest of the three for concrete nouns: one photograph of a
      // gunwale or an escarpment teaches more than any definition.
      href: `https://www.google.com/search?tbm=isch&q=${query}`,
      description: `See images of ${term}`,
    },
  ];
}
