// The end of a run, as words: who the run beat, and the message Challenge a friend
// copies. A username tells nothing about the person, so no message uses a pronoun.
// Usernames go in bare: on X an "@" before a GitHub username tags whoever owns that X handle.

/**
 * One round of a finished run: who it was against and how it went. `receipt` is the pool
 * the opponent was drafted from (Player.receipt), so a saved team is replayed against it.
 */
export type RoundResult = { round: number; opponent: string; outcome: "won" | "lost" | "draw"; receipt?: string };

// More names than this make the line wrap on a phone; the rest are counted.
const NAMED = 3;

/** The accounts a run beat, each once, in the order it beat them. */
export const beatenIn = (results: RoundResult[]): string[] => [...new Set(results.filter((result) => result.outcome === "won").map((result) => result.opponent))];

/** "a", "a and b", "a, b and c", "a, b, c and 2 more". */
function named(logins: string[]): string {
  const handles = logins.slice(0, NAMED);
  const more = logins.length - handles.length;
  if (more > 0) return `${handles.join(", ")} and ${more} more`;
  if (handles.length === 1) return handles[0];
  return `${handles.slice(0, -1).join(", ")} and ${handles.at(-1)}`;
}

/** The end screen's lead line; null when the run beat nobody. */
export const beatLine = (beaten: string[]): string | null => (beaten.length === 0 ? null : `You beat ${named(beaten)}`);

/** The team link with the friend it challenges, whom the team page then greets. */
export const challengeLink = (teamLink: string, friend: string): string => (friend ? `${teamLink}&to=${friend}` : teamLink);

/** A finished instant battle as a post's words, for whoever shares the battle. */
export const battleText = (winner: string, loser: string, left: number): string => `${winner} beat ${loser} with ${left} ${left === 1 ? "card" : "cards"} left in a battle of GitHub stars on Stard.`;

/** The challenge's words before the link: the result, and the friend named when there is one. */
export function challengeText(beaten: string[], friend: string): string {
  const result = beaten.length === 0 ? "I drafted a team from my GitHub stars on Stard." : `I beat ${named(beaten)} with my GitHub stars on Stard.`;
  return `${result} ${friend ? `${friend}, beat my team:` : "Beat my team:"}`;
}

/** What Challenge a friend copies: the challenge's words and the link. */
export const challengeMessage = (beaten: string[], teamLink: string, friend: string): string => `${challengeText(beaten, friend)} ${challengeLink(teamLink, friend)}`;
