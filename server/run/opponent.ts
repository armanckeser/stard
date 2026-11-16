import { CLASS_IDS, type ClassId } from "../character.ts";
import { BOOST_ROUNDS, boostOffer } from "./boosts.ts";
import { BENCH_SIZE, REROLL_COST, ROUND_GOLD, START_GOLD, WIN_GOLD, openingScale, costOf, freeCell, scaledBy, shopFor, shuffled, teamSizeAt, type Pool, type RunFighter, type Unit } from "./rules.ts";
import { teamSets } from "./sets.ts";

// The team a well-known account fields at a round of someone's run, built the way a
// player builds one: the same gold, shops, rerolls and boosts, and a class. Pure and
// seeded, so the Play screen and the Worker that referees the run build the same team.
//
// A player who builds well beats a team built like their own about half the time, which
// is harder than a first run should be. OPPONENT_STRENGTH scales the cards' stats by round,
// so a run starts easy and gets harder (opponent-strength.test.ts measures the ramp).

/** The share of their stats an opponent's cards fight with, by round; from the last entry on, that one. */
// Measured with scripts/balance/ramp.ts on the 12 opponents' and the owner's live pools
// (2026-11-15), a player who builds well wins 84% of round 1s, 78%, 72%, 62%, then 58%,
// and 57% of runs. A team built like the player's at full strength wins about half.
export const OPPONENT_STRENGTH: readonly number[] = [0.9, 0.85, 0.91, 0.94, 0.96];

/** Rerolls an opponent spends in a round before it stops looking. */
const REROLLS = 2;
/** A live check is worth more than any card's price, so a board is built around its families first. */
const CHECK_WEIGHT = 100;

export type OpponentTeam = { units: Unit[]; boosts: string[]; klass: ClassId };

const statTotal = (fighter: RunFighter) => fighter.card.hp + fighter.card.attack + fighter.card.guard + fighter.card.speed;
const liveChecks = (fighters: RunFighter[]) => teamSets({ units: fighters.map((fighter) => ({ card: fighter.card, col: 0, row: 0 })) }).filter((entry) => entry.tier).length;
const worth = (board: RunFighter[]) => liveChecks(board) * CHECK_WEIGHT + board.reduce((sum, fighter) => sum + costOf(fighter) + statTotal(fighter) / 10_000, 0);

/** The best `limit` cards of `owned` for a board, picked one at a time; the ace always plays. */
function bestBoard(owned: RunFighter[], limit: number): RunFighter[] {
  const board = owned.slice(0, 1);
  const rest = owned.slice(1);
  while (board.length < limit && rest.length > 0) {
    rest.sort((x, y) => worth([...board, y]) - worth([...board, x]));
    board.push(rest.shift()!);
  }
  return board;
}

/** The account's own class, or one dealt by the run's seed when it has none. */
export function opponentClass(login: string, klass: ClassId, seed: string): ClassId {
  if (klass !== "rookie") return klass;
  return shuffled(CLASS_IDS.filter((id) => id !== "rookie"), `${login.toLowerCase()}|${seed}|class`)[0];
}

/** The board and boosts a player who builds well has at `round`: buying for live checks, then price, with up to REROLLS a round. */
export function draftTeam(opponent: Pool<RunFighter>, round: number, seed: string): { board: RunFighter[]; boosts: string[] } {
  const owned = opponent.team.slice(0, 1);
  const boosts: string[] = [];
  let gold = START_GOLD;
  for (let r = 1; r <= round && owned.length > 0; r++) {
    const limit = teamSizeAt(r);
    let rerolls = 0;
    for (;;) {
      const board = bestBoard(owned, limit);
      const shop = shopFor(opponent, owned, r, rerolls, seed).filter((fighter) => costOf(fighter) <= gold);
      const gain = (fighter: RunFighter) => worth(bestBoard([...owned, fighter], limit)) - worth(board);
      const [pick] = shop.filter((fighter) => gain(fighter) > 0).sort((x, y) => gain(y) - gain(x));
      if (pick && owned.length < limit + BENCH_SIZE) {
        owned.push(pick);
        gold -= costOf(pick);
      } else if (rerolls < REROLLS && gold > REROLL_COST) {
        rerolls++;
        gold -= REROLL_COST;
      } else break;
    }
    if (r < round && (BOOST_ROUNDS as readonly number[]).includes(r)) boosts.push(...boostOffer(`${opponent.login}|${seed}|${r}`, boosts).slice(0, 1));
    gold += ROUND_GOLD + WIN_GOLD;
  }
  return { board: bestBoard(owned, teamSizeAt(round)), boosts };
}

/** The opponent's team at `round` of the run seeded `seed`: drafted like a player's, at OPPONENT_STRENGTH. */
export function opponentTeam(opponent: Pool<RunFighter>, klass: ClassId, round: number, seed: string, strength = OPPONENT_STRENGTH): OpponentTeam {
  const { board, boosts } = draftTeam(opponent, round, seed);
  const share = strength[Math.min(round, strength.length) - 1];
  const team = board.map((fighter) => scaledBy(fighter, (round === 1 ? openingScale(fighter) : 1) * share));
  const units: Unit[] = [];
  for (const fighter of [...team].sort((x, y) => y.defense - x.defense)) {
    const cell = freeCell(units, fighter);
    if (cell) units.push({ fighter, ...cell });
  }
  return { units, boosts, klass: opponentClass(opponent.login, klass, seed) };
}
