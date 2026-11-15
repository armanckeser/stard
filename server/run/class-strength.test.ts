import { describe, expect, test } from "vitest";
import { classStrengthOf, FIXTURE_NOW, fixtureRepos } from "./balance-fixture.ts";
import { CLASS_EFFECTS } from "./classes.ts";
import { cardFor } from "./stats.ts";

// Regression guarded: a class that decides fights makes every other class a wrong pick,
// and one that does nothing is a lie on the character sheet. Each class must win +5 to
// +9 win-rate points over the same fights without it (balance-fixture.ts classStrengthOf).

const FIGHTS = 2000;
const BAND: [number, number] = [5, 9];
const cards = fixtureRepos().map((repo) => cardFor(repo, FIXTURE_NOW));

describe("class strength", () => {
  test.each(Object.keys(CLASS_EFFECTS) as (keyof typeof CLASS_EFFECTS)[])("%s wins its band of points", (klass) => {
    const gained = classStrengthOf(klass, cards, FIGHTS);
    expect(gained).toBeGreaterThanOrEqual(BAND[0]);
    expect(gained).toBeLessThanOrEqual(BAND[1]);
  });
});
