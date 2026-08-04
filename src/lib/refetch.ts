/**
 * What to say after asking the dictionary again.
 *
 * Both places that offer a refetch need this wording, and the two must not drift: a
 * silent button is indistinguishable from a broken one, and a button that reports the
 * wrong thing is worse than either.
 *
 * The texts differ on whether the word is already filed, because the reassurance does.
 * "Your word is safe" is true of a saved record and a lie about one still sitting in an
 * unsaved form — there, the useful thing to say is that saving it now costs nothing.
 */

export type RefetchOutcome = 'updated' | 'notfound' | 'unavailable' | 'missing';

/** The capture form has nothing to lose track of, so `missing` cannot happen there. */
export type LookupRetryOutcome = Exclude<RefetchOutcome, 'missing'>;

export interface RefetchMessage {
  tone: 'ok' | 'bad';
  text: string;
}

export interface RefetchContext {
  /** True once the word is in the shelf; false while it is still a draft in the form. */
  saved: boolean;
}

export function refetchMessageFor(
  outcome: RefetchOutcome,
  { saved }: RefetchContext,
): RefetchMessage {
  switch (outcome) {
    case 'updated':
      return { tone: 'ok', text: 'Definition refreshed from the dictionary.' };

    case 'notfound':
      return {
        tone: 'bad',
        text: saved
          ? 'The dictionary still has no entry for this word. Anything you had is untouched — the links below may help.'
          : 'The dictionary still has no entry for this word. Save it anyway and write your own meaning — the links below may help.',
      };

    case 'unavailable':
      return {
        tone: 'bad',
        text: saved
          ? "Couldn't reach the dictionary. Your word is safe; try again when the connection is better."
          : "Couldn't reach the dictionary. Save it now — the definition fills itself in once you're back online.",
      };

    case 'missing':
      return { tone: 'bad', text: 'This word is no longer in your shelf.' };
  }
}
