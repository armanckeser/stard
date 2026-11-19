import { CLASS_IDS, type ClassId } from "../character.ts";
import { BOOST_ROUNDS, boostOffer } from "./boosts.ts";
import { BENCH_SIZE, REROLL_COST, ROUND_GOLD, SLOT_COST, START_GOLD, WIN_GOLD, boardLimit, levelOf, openingScale, costOf, freeCell, scaledBy, shopFor, shuffled, type Pool, type RunFighter, type Unit } from "./rules.ts";
import { TIERS, teamSets } from "./sets.ts";

// The team a well-known account fields at a round of someone's run, built the way a
// player builds one: the same gold, shops, rerolls and boosts, and a class. Pure and
// seeded, so the Play screen and the Worker that referees the run build the same team.
//
// A player who builds well beats a team built like their own about half the time, which
// is harder than a first run should be. LEVELS scale the cards' stats by round,
// so a run starts easy and gets harder (opponent-strength.test.ts measures the ramp).

/**
 * The share of their stats an opponent's cards fight with, by round (from the last entry on,
 * that one), at each level. A run's level is in its seed (levelOf): a browser plays level 1
 * until it wins a run, then level 2.
 */
// Both levels are set on real play (scripts/balance/replay.ts, 2026-11-19): the 11 saved
// teams of runs that reached round 5, 9 of them the owner's. Once assassins stopped
// leaping, those teams won far more, so the levels sit halfway between the old ones and a
// full retune to them: tuning fully would fit one player's deck and leave draftTeam, the
// closer stand-in for a new player, winning 17% of level-2 runs. Saved teams win 90%, 89%,
// 76%, 84%, 91% by round at level 1 and 90%, 86%, 73%, 77%, 66% at level 2; ramp.ts shows
// draftTeam winning 66% of runs at level 1 and 31% at level 2.
export const LEVELS: readonly (readonly number[])[] = [
  [0.87, 0.81, 0.88, 0.88, 0.85],
  [0.87, 0.85, 0.92, 0.99, 1.13],
];

/** The strengths a run seeded `seed` meets. */
export const strengthFor = (seed: string): readonly number[] => LEVELS[Math.min(levelOf(seed), LEVELS.length) - 1];

/** Rerolls an opponent spends in a round before it stops looking. */
const REROLLS = 2;
/** A live check is worth more than any card's price, so a board is built around its families first. */
const CHECK_WEIGHT = 100;

export type OpponentTeam = { units: Unit[]; boosts: string[]; klass: ClassId };

const statTotal = (fighter: RunFighter) => fighter.card.hp + fighter.card.attack + fighter.card.guard + fighter.card.speed;
const liveChecks = (fighters: RunFighter[]) => teamSets({ units: fighters.map((fighter) => ({ card: fighter.card, col: 0, row: 0 })) }).reduce((sum, entry) => sum + (entry.tier ? entry.tier.at / TIERS[0] : 0), 0);
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

/**
 * The board and boosts a player who builds well has at `round`: buying for live checks, then
 * price, with up to REROLLS a round, and a board slot whenever a card is there to fill it.
 */
export function draftTeam(opponent: Pool<RunFighter>, round: number, seed: string): { board: RunFighter[]; boosts: string[] } {
  const owned = opponent.team.slice(0, 1);
  const boosts: string[] = [];
  let gold = START_GOLD;
  let bought = 0;
  for (let r = 1; r <= round && owned.length > 0; r++) {
    let rerolls = 0;
    for (;;) {
      const limit = boardLimit(r, bought);
      const board = bestBoard(owned, limit);
      // A sale refunds the full price, so a card that wouldn't play is sold for gold.
      for (const fighter of owned.filter((card) => !board.includes(card))) {
        owned.splice(owned.indexOf(fighter), 1);
        gold += costOf(fighter);
      }
      const shop = shopFor(opponent, owned, r, rerolls, seed).filter((fighter) => costOf(fighter) <= gold);
      const gain = (fighter: RunFighter) => worth(bestBoard([...owned, fighter], limit)) - worth(board);
      const [pick] = shop.filter((fighter) => gain(fighter) > 0).sort((x, y) => gain(y) - gain(x));
      const slotFills = shop.some((fighter) => costOf(fighter) <= gold - SLOT_COST);
      if (pick && owned.length < limit + BENCH_SIZE) {
        owned.push(pick);
        gold -= costOf(pick);
      } else if (gold >= SLOT_COST && boardLimit(r, bought + 1) > limit && slotFills) {
        bought++;
        gold -= SLOT_COST;
      } else if (rerolls < REROLLS && gold > REROLL_COST) {
        rerolls++;
        gold -= REROLL_COST;
      } else break;
    }
    if (r < round && (BOOST_ROUNDS as readonly number[]).includes(r)) boosts.push(...boostOffer(`${opponent.login}|${seed}|${r}`, boosts).slice(0, 1));
    gold += ROUND_GOLD + WIN_GOLD;
  }
  return { board: bestBoard(owned, boardLimit(round, bought)), boosts };
}

/** The opponent's team at `round` of the run seeded `seed`: drafted like a player's, at the run's level. */
export function opponentTeam(opponent: Pool<RunFighter>, klass: ClassId, round: number, seed: string, strength = strengthFor(seed)): OpponentTeam {
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
