import { describe, expect, it } from "vitest";
import { ABILITIES } from "./abilities.ts";
import { BOOSTS } from "./boosts.ts";
import { CLASS_EFFECTS } from "./classes.ts";
import { CLASSES } from "../character.ts";
import { CONDITIONS } from "./hooks.ts";
import { CONDITION_WORDS, conditionOfWord, conditionTip, withFirst } from "./names.ts";
import { FAMILIES, TOPIC } from "./sets.ts";

// The card-text rule (docs/GAME-UI.md §10): a trigger and an effect, at most 8 words,
// naming the thing instead of pointing at it. Regression guarded: card text growing back
// into sentences ("Whoever hits it is rate limited.") that a player has to decode mid-shop.

const MAX_WORDS = 8;
const POINTERS = /\b(it|its|whoever|them|one)\b/i;

const texts: [string, string][] = [
  ...ABILITIES.map((ability): [string, string] => [ability.name, ability.text]),
  ...BOOSTS.map((boost): [string, string] => [boost.name, boost.text]),
  ...Object.entries(CLASS_EFFECTS).map(([klass, effect]): [string, string] => [klass, effect.text]),
  ...[...Object.entries(FAMILIES), ["topic", TOPIC] as const].flatMap(([set, bonus]) => bonus.tiers.map((tier): [string, string] => [`${set} at ${tier.at}`, tier.text])),
];

describe("card text", () => {
  it.each(texts)("%s: at most 8 words, no pointer words", (_, text) => {
    expect(text.split(/\s+/).length).toBeLessThanOrEqual(MAX_WORDS);
    expect(text).not.toMatch(POINTERS);
  });

  // Regression guarded: the class picker showed Maintainer as "Fight start: {first} gains an 8% HP shield."
  it("shows every class's effect with its card named", () => {
    for (const klass of Object.values(CLASSES)) expect(klass.perk).not.toContain("{");
  });

  it("names the team's first card, or the ace when there's no team", () => {
    const headStart = BOOSTS.find((boost) => boost.id === "head-start")!.text;
    expect(withFirst(headStart, "react")).toBe("Fight start: react gains a 30% HP shield.");
    expect(withFirst(headStart)).toBe("Fight start: your ace gains a 30% HP shield.");
  });
});

describe("condition words", () => {
  it("finds each condition a card gives, so its word can explain itself", () => {
    const named = new Set(texts.flatMap(([, text]) => {
      const word = CONDITION_WORDS.exec(text)?.[0];
      return word ? [conditionOfWord(word)] : [];
    }));
    expect([...named].sort()).toEqual([...CONDITIONS].sort());
  });

  it.each([
    ["flaky", "Flaky: 25% chance to miss, for 3 s"],
    ["rate-limited", "Rate limited: 33% slower attacks, for 3 s"],
    ["deprecated", "Deprecated: loses 3% max HP per second, for 3 s"],
    ["merge-conflict", "Merge conflict: 33% chance to hit itself, for 3 s"],
  ] as const)("explains %s with the fight's own numbers", (condition, tip) => {
    expect(conditionTip(condition)).toBe(tip);
  });
});
