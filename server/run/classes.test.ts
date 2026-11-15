import { describe, expect, it } from "vitest";
import { classHooks } from "./classes.ts";
import { GAME_RULES } from "./game-rules.ts";
import { card, greendale } from "./testbed.ts";
import type { Snapshot } from "./types.ts";

// Regression guarded (#129): the class picked in Play did nothing in a run, because run
// fights never read it. And a class that reaches the wrong cards (Scout on a 5-gold card,
// Specialist on a family of one beside a pair) plays differently from what its words say.

const team = (types: string[], rarities: number[] = types.map(() => 0)): Snapshot => ({
  login: "greendale",
  round: 3,
  units: types.map((type, index) => ({ card: card(`greendale/${index}`, { type, rarity: rarities[index] as 0 }), col: index, row: 0 })),
  boosts: [],
});
const reached = (snapshot: Snapshot) => classHooks(snapshot).flatMap((hooks, index) => (hooks.length > 0 ? [index] : []));

describe("class hooks", () => {
  it("run fights carry the team's class", () => {
    const hooks = GAME_RULES.hooks({ ...greendale(), klass: "veteran" }, 0);
    expect(hooks.every((unit) => unit.some((hook) => hook.source === "class:veteran"))).toBe(true);
  });

  it("gives a rookie and a team with no class nothing", () => {
    expect(reached({ ...team(["web", "apps"]), klass: "rookie" })).toEqual([]);
    expect(reached(team(["web", "apps"]))).toEqual([]);
  });

  it.each([
    ["maintainer", team(["web", "apps", "data"]), [0]],
    ["scout", team(["web", "apps", "data"], [0, 1, 4]), [0, 1]],
    ["specialist", team(["web", "apps", "apps", "data"]), [1, 2]],
    ["veteran", team(["web", "apps"]), [0, 1]],
  ] as const)("%s reaches the cards its words name", (klass, snapshot, indexes) => {
    expect(reached({ ...snapshot, klass })).toEqual(indexes);
  });

  it("collector grows with each family on the team", () => {
    const attack = (types: string[]) => classHooks({ ...team(types), klass: "collector" })[0][0].effects[0];
    expect(attack(["web", "web", "web"])).toMatchObject({ stat: "attack", by: 0.03 });
    expect(attack(["web", "apps", "data"])).toMatchObject({ stat: "attack", by: 0.09 });
  });
});
