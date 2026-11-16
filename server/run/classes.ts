import type { ClassId } from "../character.ts";
import type { Effect, Hook, Trigger } from "./hooks.ts";
import type { Snapshot } from "./types.ts";

// A class's run effect: one always-on bonus for the whole run, made of the same parts
// as a boost. Each wins about as much as the others (class-strength.test.ts), so no
// class is the obvious pick. A rookie has none.

/** `reaches(team)` lists the indexes of the cards that carry the effect; `effects` may depend on the team. */
export type ClassEffect = { text: string; reaches: (team: Snapshot) => number[]; on: Trigger; effects: Effect[] | ((team: Snapshot) => Effect[]) };

/** Card text with `{first}` named: the team's first card (a boost's `first`), or "your ace" when no team is at hand. */
export const withFirst = (text: string, first?: string): string => text.replace("{first}", first ?? "your ace");

const every = (team: Snapshot) => team.units.map((_, index) => index);
const ownerOf = (card: { fullName: string }) => card.fullName.split("/")[0].toLowerCase();
const VETERAN_YEARS = 8;

/** The cards of the family most cards on the team share; on a tie, the family met first. */
function biggestFamily(team: Snapshot): number[] {
  const counts = new Map<string, number>();
  for (const { card } of team.units) counts.set(card.type, (counts.get(card.type) ?? 0) + 1);
  const [family] = [...counts].reduce((best, entry) => (entry[1] > best[1] ? entry : best), ["", 0]);
  return every(team).filter((index) => team.units[index].card.type === family);
}

export const CLASS_EFFECTS: Record<Exclude<ClassId, "rookie">, ClassEffect> = {
  maintainer: { text: "Your ace and own repos gain 45% attack.", reaches: (team) => every(team).filter((index) => index === 0 || ownerOf(team.units[index].card) === team.login.toLowerCase()), on: "start", effects: [{ kind: "stat", aim: "self", stat: "attack", by: 0.45 }] },
  scout: { text: "Cards under 1,000 stars gain 25% attack.", reaches: (team) => every(team).filter((index) => team.units[index].card.rarity <= 1), on: "start", effects: [{ kind: "stat", aim: "self", stat: "attack", by: 0.25 }] },
  collector: { text: "Every card gains 3% attack per family.", reaches: every, on: "start", effects: (team) => [{ kind: "stat", aim: "self", stat: "attack", by: 0.03 * new Set(team.units.map((unit) => unit.card.type)).size }] },
  specialist: { text: "Your biggest family gains 20% attack.", reaches: biggestFamily, on: "start", effects: [{ kind: "stat", aim: "self", stat: "attack", by: 0.2 }] },
  veteran: { text: "Repos 8+ years old gain 20% guard.", reaches: (team) => every(team).filter((index) => (team.units[index].card.age ?? 0) >= VETERAN_YEARS), on: "start", effects: [{ kind: "stat", aim: "self", stat: "guard", by: 0.2 }] },
  archivist: { text: "Quiet repos gain a 6% HP shield.", reaches: (team) => every(team).filter((index) => team.units[index].card.quiet === true), on: "start", effects: [{ kind: "shield", aim: "self", share: 0.06 }] },
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
