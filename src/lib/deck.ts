// The deck a player picked for their runs: one of their public GitHub Lists, by its slug
// (worker/src/battle.ts draws up to half a run's pool from it). Kept in this browser
// only, per account; the run itself carries the deck it was dealt with.

const keyOf = (login: string) => `stard:deck:${login.toLowerCase()}`;

/** The deck picked for `login`'s runs, or undefined for all their stars. */
export function deckFor(login: string): string | undefined {
  try {
    return localStorage.getItem(keyOf(login)) ?? undefined;
  } catch {
    // Storage can be blocked (a private window, site data turned off): every run uses all stars.
    return undefined;
  }
}

/** Picks the deck for `login`'s next runs; undefined goes back to all their stars. */
export function chooseDeck(login: string, slug: string | undefined): void {
  try {
    if (slug) localStorage.setItem(keyOf(login), slug);
    else localStorage.removeItem(keyOf(login));
  } catch {
    // Not kept: the pick still holds for this page's next run through the caller's state.
  }
}
