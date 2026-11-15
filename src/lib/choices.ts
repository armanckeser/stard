import type { ClassId, Look } from "../../server/character";

// What a player picked in the Customize sheet (src/components/run/customize.tsx): a deck
// (one of their public Lists, by slug), an ace (owner/name), and their character's class
// and look. Kept in this browser only, per account; each run carries what it was dealt
// with, and its team link carries the class and look.

export type Choices = { deck?: string; ace?: string; klass?: ClassId; look?: Look };

const keyOf = (login: string) => `stard:choices:${login.toLowerCase()}`;

/** What was picked for `login`'s runs; nothing picked is an empty object. */
export function choicesFor(login: string): Choices {
  try {
    const kept = localStorage.getItem(keyOf(login));
    return kept ? (JSON.parse(kept) as Choices) : {};
  } catch {
    // Storage can be blocked (a private window, site data turned off) or hold something
    // unreadable: the run is dealt as if nothing was picked.
    return {};
  }
}

/** Changes what is picked for `login`'s next runs; a field set to undefined goes back to the default. */
export function pickFor(login: string, change: Choices): Choices {
  const next = { ...choicesFor(login), ...change };
  try {
    localStorage.setItem(keyOf(login), JSON.stringify(next));
  } catch {
    // Not kept past this page; the caller still holds the pick.
  }
  return next;
}
