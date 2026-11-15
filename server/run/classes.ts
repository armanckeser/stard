import type { ClassId } from "../character.ts";
import type { Effect, Hook, Trigger } from "./hooks.ts";
import type { Snapshot } from "./types.ts";

// A class's run effect: one always-on bonus for the whole run, made of the same parts
// as a boost. Each wins about as much as the others (class-strength.test.ts), so no
// class is the obvious pick. A rookie has none.

/** `reaches(team)` lists the indexes of the cards that carry the effect; `effects` may depend on the team. */
export type ClassEffect = { text: string; reaches: (team: Snapshot) => number[]; on: Trigger; effects: Effect[] | ((team: Snapshot) => Effect[]) };

const every = (team: Snapshot) => team.units.map((_, index) => index);

/** The cards of the family most cards on the team share; on a tie, the family met first. */
function biggestFamily(team: Snapshot): number[] {
  const counts = new Map<string, number>();
  for (const { card } of team.units) counts.set(card.type, (counts.get(card.type) ?? 0) + 1);
  const [family] = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), ["", 0]);
  return every(team).filter((index) => team.units[index].card.type === family);
}

export const CLASS_EFFECTS: Record<Exclude<ClassId, "rookie">, ClassEffect> = {
  maintainer: { text: "Your first card starts with a shield of 8% of its HP.", reaches: () => [0], on: "start", effects: [{ kind: "shield", aim: "self", share: 0.08 }] },
  scout: { text: "1- and 2-gold cards hit 25% harder.", reaches: (team) => every(team).filter((index) => team.units[index].card.rarity <= 1), on: "start", effects: [{ kind: "stat", aim: "self", stat: "attack", by: 0.25 }] },
  collector: { text: "Every card hits 3% harder for each family on your team.", reaches: every, on: "start", effects: (team) => [{ kind: "stat", aim: "self", stat: "attack", by: 0.03 * new Set(team.units.map((unit) => unit.card.type)).size }] },
  specialist: { text: "Cards of your biggest family hit 20% harder.", reaches: biggestFamily, on: "start", effects: [{ kind: "stat", aim: "self", stat: "attack", by: 0.2 }] },
  veteran: { text: "Every card has 10% more guard.", reaches: every, on: "start", effects: [{ kind: "stat", aim: "self", stat: "guard", by: 0.1 }] },
  archivist: { text: "When a card faints, its teammates heal 3%.", reaches: every, on: "ally-faint", effects: [{ kind: "heal", aim: "self", share: 0.03 }] },
};

/** The class hooks each unit carries: `classHooks(team)[i]` belongs to `team.units[i]`. A rookie or an unknown class carries none. */
export function classHooks(team: Snapshot): Hook[][] {
  const hooks: Hook[][] = team.units.map(() => []);
  const effect = team.klass && team.klass !== "rookie" ? CLASS_EFFECTS[team.klass] : undefined;
  if (!effect) return hooks;
  const effects = typeof effect.effects === "function" ? effect.effects(team) : effect.effects;
  for (const index of effect.reaches(team)) hooks[index].push({ source: `class:${team.klass}`, on: effect.on, effects });
  return hooks;
}
