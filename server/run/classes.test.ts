import { describe, expect, it } from "vitest";
import { classHooks } from "./classes.ts";
import { GAME_RULES } from "./game-rules.ts";
import { card, greendale } from "./testbed.ts";
import type { Snapshot } from "./types.ts";

// Regression guarded (#129): the class picked in Play did nothing in a run, because run
// fights never read it. And a class that reaches the wrong cards (Scout on a 5-gold card,
// Specialist on a family of one beside a pair) plays differently from what its words say.

const team = (types: string[], rarities: number[] = types.map(() => 0), facts: { owner?: string; age?: number; quiet?: boolean }[] = []): Snapshot => ({
  login: "greendale",
  round: 3,
  units: types.map((type, index) => ({ card: card(`${facts[index]?.owner ?? "greendale"}/${index}`, { type, rarity: rarities[index] as 0, age: facts[index]?.age, quiet: facts[index]?.quiet }), col: index, row: 0 })),
  boosts: [],
});
const reached = (snapshot: Snapshot) => classHooks(snapshot).flatMap((hooks, index) => (hooks.length > 0 ? [index] : []));

describe("class hooks", () => {
  it("run fights carry the team's class", () => {
    const hooks = GAME_RULES.hooks({ ...greendale(), klass: "collector" }, 0);
    expect(hooks.every((unit) => unit.some((hook) => hook.source === "class:collector"))).toBe(true);
  });

  it("gives a rookie and a team with no class nothing", () => {
    expect(reached({ ...team(["web", "apps"]), klass: "rookie" })).toEqual([]);
    expect(reached(team(["web", "apps"]))).toEqual([]);
  });

  it.each([
    // The ace, and the player's own repos further down; not someone else's.
    ["maintainer", team(["web", "apps", "data"], [0, 0, 0], [{ owner: "troy" }, { owner: "troy" }, { owner: "Greendale" }]), [0, 2]],
    ["scout", team(["web", "apps", "data"], [0, 1, 4]), [0, 1]],
    ["specialist", team(["web", "apps", "apps", "data"]), [1, 2]],
    ["veteran", team(["web", "apps", "data"], [0, 0, 0], [{ age: 8 }, { age: 7 }, {}]), [0]],
    ["archivist", team(["web", "apps", "data"], [0, 0, 0], [{ quiet: true }, { quiet: false }, {}]), [0]],
  ] as const)("%s reaches the cards its words name", (klass, snapshot, indexes) => {
    expect(reached({ ...snapshot, klass })).toEqual(indexes);
  });

  it("collector grows with each family on the team", () => {
    const attack = (types: string[]) => classHooks({ ...team(types), klass: "collector" })[0][0].effects[0];
    expect(attack(["web", "web", "web"])).toMatchObject({ stat: "attack", by: 0.03 });
    expect(attack(["web", "apps", "data"])).toMatchObject({ stat: "attack", by: 0.09 });
  });
});
