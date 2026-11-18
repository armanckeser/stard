import { describe, expect, test } from "vitest";
import { CLASS_IDS } from "../character.ts";
import { FIXTURE_NOW, fixtureRepos } from "./balance-fixture.ts";
import { fight } from "./fight.ts";
import { draftTeam, opponentTeam } from "./opponent.ts";
import { freeCell, shuffled, snapshot, winnerOf, type Pool, type RunFighter, type Unit } from "./rules.ts";
import { cardFor } from "./stats.ts";

// Regression guarded: round 1 was tuned to about 70% and drifted to 90% as cards and
// abilities changed, and no later round had a target at all, so runs became a formality.
// LEVELS are tuned on real players' teams (server/run/opponent.ts); draftTeam
// builds weaker ones, so here the bands are for draftTeam: easy at first, then a real fight.
// The fixture's pools differ from live ones, so the bands are wide.

const POOLS = 5;
const RUNS = 40;
// By level: level 1 is a browser's first runs, level 2 once it has won one.
const BANDS: Record<number, Record<number, [number, number]>> = { 1: { 1: [72, 95], 3: [52, 85], 5: [38, 72] }, 2: { 1: [72, 95], 3: [42, 70], 5: [12, 40] } };

const repos = fixtureRepos();
const pools: Pool<RunFighter>[] = Array.from({ length: POOLS }, (_, p) => ({
  login: `player${p}`,
  team: repos.slice(p * 40, p * 40 + 40).map((repo) => {
    const card = cardFor(repo, FIXTURE_NOW);
    return { fullName: card.fullName, hp: card.hp, attack: card.attack, defense: card.guard, speed: card.speed, card } as RunFighter;
  }),
}));
const classes = CLASS_IDS.filter((id) => id !== "rookie");
const placed = (fighters: RunFighter[]): Unit[] => {
  const units: Unit[] = [];
  for (const fighter of fighters) {
    const cell = freeCell(units, fighter);
    if (cell) units.push({ fighter, ...cell });
  }
  return units;
};

function winRateAt(level: number, round: number): number {
  let won = 0;
  let played = 0;
  pools.forEach((player, p) => {
    const opponent = pools[(p + 1) % POOLS];
    for (let i = 0; i < RUNS; i++) {
      const seed = `${level}.strength${i}`;
      const mine = draftTeam(player, round, seed);
      const theirs = opponentTeam(opponent, "rookie", round, seed);
      const a = snapshot(player.login, round, placed(mine.board), mine.boosts, shuffled(classes, `${player.login}|${seed}`)[0]);
      const b = snapshot(opponent.login, round, theirs.units, theirs.boosts, theirs.klass);
      won += Number(winnerOf(fight(a, b, `${seed}|${round}`)) === 0);
      played++;
    }
  });
  return (won / played) * 100;
}

describe("the run gets harder", () => {
  const cases = Object.entries(BANDS).flatMap(([level, rounds]) => Object.keys(rounds).map((round) => [Number(level), Number(round)] as const));
  test.each(cases)("at level %i, round %i is won within its band", (level, round) => {
    const rate = winRateAt(level, round);
    expect(rate).toBeGreaterThanOrEqual(BANDS[level][round][0]);
    expect(rate).toBeLessThanOrEqual(BANDS[level][round][1]);
  }, 120_000);
});
