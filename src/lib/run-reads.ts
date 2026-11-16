import { choicesFor, pickFor } from "@/lib/choices";
import { fetchOpponent, fetchPlayer, type Player, type Unit } from "@/lib/run";
import { opponentTeam } from "../../server/run/opponent";
import type { Run, RunAction } from "@/lib/run-state";
import { openTeam, savedRound, type SavedTeam } from "@/lib/saved-team";

// What the Play screen reads from the Worker as a run starts and as each round opens,
// as the actions that end its loading phases (src/lib/run-state.ts).

/** The message a failed read shows: the Worker's own words, or `otherwise` when the network failed. */
const messageOf = (cause: unknown, otherwise: string) => (cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : otherwise);

/** A round's opponent: the saved team's owner on a challenge run, else an account read from the Worker. */
async function readRound(player: Player, number: number, seed: string, against: SavedTeam | null): Promise<{ opponent: Player; theirs: Unit[]; theirBoosts: string[] }> {
  if (against) return savedRound(against, number);
  const opponent = await fetchOpponent(player.login, number, seed);
  // The next opponent follows from the name, the seed and the round, not from how this
  // round goes, so it is read while this one is played and Continue finds it waiting.
  // A failed read is dropped from the cache (src/lib/run.ts), and Continue reads it again.
  fetchOpponent(player.login, number + 1, seed).catch(() => {});
  // Drafted the way a player drafts, with the class it fights with shown on its profile.
  const team = opponentTeam(opponent, opponent.character.klass, number, seed);
  return { opponent: { ...opponent, character: { ...opponent.character, klass: team.klass } }, theirs: team.units, theirBoosts: team.boosts };
}

/** The player's cards, the saved team on a challenge run, and round 1, as the action that ends the run's loading. */
export async function readRun(login: string, seed: string, againstToken: string | undefined): Promise<RunAction> {
  try {
    // Round 1's opponent is known from the name and the seed alone, so both teams are read at once.
    if (!againstToken) fetchOpponent(login, 1, seed).catch(() => {});
    const [player, against] = await Promise.all([playerFor(login), againstToken ? openTeam(againstToken) : null]);
    return { type: "run-read", seed, player, against, ...(await readRound(player, 1, seed, against)) };
  } catch (cause) {
    return { type: "read-failed", seed, message: messageOf(cause, "The cards couldn't be read. Check the connection and try again.") };
  }
}

/**
 * The player as picked in this browser's Customize sheet: their cards dealt with the deck
 * and ace, and their character in the class and look. A deck that is gone (the List deleted
 * or made private) is let go, and the run uses all their stars.
 */
async function playerFor(login: string): Promise<Player> {
  const { deck, ace, klass, look } = choicesFor(login);
  let player: Player;
  try {
    player = await fetchPlayer(login, undefined, { deck, ace });
  } catch (cause) {
    // Any other failure (the network, GitHub) keeps the pick for the next try.
    if (!deck || !(cause instanceof Error && cause.message.includes("no public List"))) throw cause;
    pickFor(login, { deck: undefined });
    player = await fetchPlayer(login, undefined, { ace });
  }
  return { ...player, character: { ...player.character, ...(klass ? { klass } : {}), ...(look ? { look } : {}) } };
}

export async function readNextRound(run: Run, number: number, seed: string): Promise<RunAction> {
  try {
    return { type: "round-read", seed, number, ...(await readRound(run.player, number, seed, run.against)) };
  } catch (cause) {
    return { type: "read-failed", seed, message: messageOf(cause, "The next team couldn't be read. Check the connection and try again.") };
  }
}
