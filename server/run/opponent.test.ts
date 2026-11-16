import { describe, expect, it } from "vitest";
import { OPPONENT_STRENGTH, opponentClass, opponentTeam } from "./opponent.ts";
import { teamSizeAt, type RunFighter } from "./rules.ts";
import { roleOf } from "./stats.ts";
import { card } from "./testbed.ts";
import type { Card } from "./types.ts";

// Regression guarded: opponents took the first card of each shop and never a boost or a
// class, so a player who built at all won about 85% of runs. They now draft the way a
// player does, and OPPONENT_STRENGTH sets how hard each round is (scripts/balance/ramp.ts).

const fighter = (name: string, over: Partial<Card> = {}): RunFighter => ({ fullName: `greendale/${name}`, defense: over.guard ?? 100, card: card(`greendale/${name}`, over) }) as RunFighter;
// A legendary ace with 460 points, as BUDGET gives one, then 39 commons and rares from three families.
const legendary = { rarity: 4, hp: 230, attack: 115, guard: 115, speed: 115 } as const;
const FAMILIES = ["web", "apps", "data"];
const teamWith = (ace: Partial<Card> = legendary) => ({
  login: "greendale",
  team: [fighter("dreamatorium", ace), ...Array.from({ length: 39 }, (_, i) => fighter(`study-room-${i}`, { type: FAMILIES[i % 3], rarity: (i % 4 === 0 ? 1 : 0) as 0 }))],
});
const SEED = "greendale-run-1";
const at = (round: number, ace?: Partial<Card>) => opponentTeam(teamWith(ace), "rookie", round, SEED);
const aceOf = (round: number, ace?: Partial<Card>) => at(round, ace).units.find((unit) => unit.fighter.fullName === "greendale/dreamatorium")!.fighter.card;

describe("an opponent's team", () => {
  it("fields as many cards as the round allows, the ace among them", () => {
    for (const round of [1, 2, 3, 5]) {
      expect(at(round).units).toHaveLength(teamSizeAt(round));
      expect(aceOf(round)).toBeDefined();
    }
  });

  it("is the same team for the same run, so the Play screen and the Worker agree", () => {
    expect(at(4)).toEqual(at(4));
  });

  it("takes a boost after rounds 2 and 4, as a player does", () => {
    expect(at(2).boosts).toHaveLength(0);
    expect(at(3).boosts).toHaveLength(1);
    expect(at(5).boosts).toHaveLength(2);
  });

  it("builds around a family, as a player chasing a check does", () => {
    const families = at(5).units.map((unit) => unit.fighter.card.type);
    expect(Math.max(...FAMILIES.map((family) => families.filter((type) => type === family).length))).toBeGreaterThanOrEqual(2);
  });

  it("fights with its own class, or one the run deals when it has none", () => {
    expect(opponentClass("greendale", "veteran", SEED)).toBe("veteran");
    expect(opponentClass("greendale", "rookie", SEED)).not.toBe("rookie");
    expect(at(3).klass).toBe(opponentClass("greendale", "rookie", SEED));
  });

  it("shrinks the ace to 385 stat points in round 1, then to the round's share", () => {
    const share = OPPONENT_STRENGTH[0];
    const { attack } = aceOf(1);
    expect(attack).toBe(Math.round(115 * (385 / 460) * share));
    expect(aceOf(5).attack).toBe(Math.round(115 * OPPONENT_STRENGTH[4]));
  });

  // Regression guarded: shrinking all of a card's HP turned a bruiser ace into an assassin in
  // round 1, so it wore another body on the board and another role on its card face; and
  // rounding the shrunk stats tipped a card sitting on a role's cut into the next role.
  it.each([
    ["kentcdodds' rare ace", { rarity: 2, hp: 155, attack: 120, guard: 101, speed: 110 }, "bruiser"],
    ["a rare tank on the tank cut", { rarity: 2, hp: 156, attack: 106, guard: 102, speed: 117 }, "tank"],
    ["a rare bruiser on the assassin cut", { rarity: 2, hp: 154, attack: 113, guard: 101, speed: 118 }, "bruiser"],
    ["a common bruiser on the assassin cut", { rarity: 0, hp: 150, attack: 101, guard: 103, speed: 114 }, "bruiser"],
  ] as const)("keeps %s in its role at every round's strength", (_, ace, role) => {
    for (const round of [1, 2, 3, 4, 5]) expect(roleOf(aceOf(round, ace))).toBe(role);
  });
});
