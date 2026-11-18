import { CLASSES, isClass } from "../character.ts";
import { abilityById } from "./abilities.ts";
import { CLASS_EFFECTS } from "./classes.ts";
import { boostById } from "./boosts.ts";
import { CONDITION_TICKS, DEPRECATED_EVERY, DEPRECATED_SHARE, deprecatedLoss, FLAKY_ODDS, MERGE_CONFLICT_ODDS, RATE_LIMITED, type Condition, type Effect, type Gate, type Stat, type Trigger } from "./hooks.ts";
import { bonusOf } from "./sets.ts";
import { TICK_MS, type Card } from "./types.ts";

// What the screen calls the things a fight's events name: an ability, a set bonus,
// a boost or a condition. Fight events carry ids (`ability` events' `ability`,
// `hp` events' `cause`); these turn them into words.

export const RARITY_NAMES: Record<Card["rarity"], string> = { 0: "Common", 1: "Uncommon", 2: "Rare", 3: "Epic", 4: "Legendary" };

export const CONDITION_NAMES: Record<Condition, string> = {
  "merge-conflict": "Merge conflict",
  "rate-limited": "Rate limited",
  deprecated: "Deprecated",
  flaky: "Flaky",
};

const MILLISECONDS_PER_SECOND = 1000;
const secondsOf = (ticks: number) => (ticks * TICK_MS) / MILLISECONDS_PER_SECOND;
const PERCENT = 100;
const asPercent = (share: number) => `${Math.round(share * PERCENT)}%`;
const perSecond = secondsOf(DEPRECATED_EVERY) === 1 ? "per second" : `every ${secondsOf(DEPRECATED_EVERY)} s`;

/**
 * What each condition does to the card wearing it, in the words established games use
 * for the same thing (Blind, Chill, Burn, confusion), read from the numbers the fight
 * uses (hooks.ts). A deprecated card's loss is in HP when its full HP is known.
 */
const CONDITION_EFFECTS: Record<Condition, (fullHp?: number) => string> = {
  "merge-conflict": () => `${asPercent(MERGE_CONFLICT_ODDS)} chance to hit itself`,
  "rate-limited": () => `${asPercent(1 - 1 / RATE_LIMITED)} slower attacks`,
  deprecated: (fullHp) => `loses ${fullHp === undefined ? `${asPercent(DEPRECATED_SHARE)} max HP` : `${deprecatedLoss(fullHp)} HP`} ${perSecond}`,
  flaky: () => `${asPercent(FLAKY_ODDS)} chance to miss`,
};

/** What a condition means, for the dotted word in card text: "Flaky: 25% chance to miss, for 3 s". */
export const conditionTip = (condition: Condition): string =>
  `${CONDITION_NAMES[condition]}: ${CONDITION_EFFECTS[condition]()}, for ${secondsOf(CONDITION_TICKS)} s`;

/** The words in card text that name a condition, as they appear there. */
export const CONDITION_WORDS = /\b(rate-limit(?:s|ed)?|rate limited|flaky|deprecat(?:e|es|ed)|merge conflict)\b/i;

/** Which condition a word matched by CONDITION_WORDS names. */
export function conditionOfWord(word: string): Condition {
  const lower = word.toLowerCase();
  if (lower.startsWith("rate")) return "rate-limited";
  if (lower.startsWith("deprecat")) return "deprecated";
  if (lower === "flaky") return "flaky";
  return "merge-conflict";
}

export { withFirst } from "./classes.ts";

/**
 * A condition as a sentence, for a card with `fullHp` and `ticksLeft` of it to go:
 * "Rate limited: 33% slower attacks, 2 s left". The seconds round up, so a condition
 * still on never reads "0 s left".
 */
export function conditionLine(condition: Condition, ticksLeft: number, fullHp: number): string {
  const seconds = Math.max(1, Math.ceil(secondsOf(ticksLeft)));
  return `${CONDITION_NAMES[condition]}: ${CONDITION_EFFECTS[condition](fullHp)}, ${seconds} s left`;
}

/** Sets whose name is not the set written with a capital letter. */
const SET_NAMES: Record<string, string> = {
  ai: "AI",
  cli: "CLI",
  api: "API",
  ios: "iOS",
  macos: "macOS",
  llm: "LLM",
};

/** A set as written on a card: "systems" is Systems, "cli" is CLI. */
export const setName = (set: string) => SET_NAMES[set] ?? set.charAt(0).toUpperCase() + set.slice(1);

export type Source = { kind: "ability" | "set" | "boost" | "class" | "condition"; name: string };

/** What an event's `ability` or `cause` is, in words. An unknown id comes back as written. */
export function sourceOf(id: string): Source {
  if (id.startsWith("set:")) {
    return { kind: "set", name: setName(id.slice("set:".length)) };
  }
  if (id.startsWith("boost:")) {
    const boost = id.slice("boost:".length);
    return { kind: "boost", name: boostById(boost)?.name ?? boost };
  }
  if (id.startsWith("class:")) {
    const klass = id.slice("class:".length);
    return { kind: "class", name: isClass(klass) ? CLASSES[klass].label : klass };
  }
  if (id in CONDITION_NAMES) return { kind: "condition", name: CONDITION_NAMES[id as Condition] };
  return { kind: "ability", name: abilityById(id)?.name ?? id };
}

const TRIGGER_WORDS: Record<Trigger, string> = { start: "Start", hit: "Hit", hurt: "Hurt", "ally-faint": "Ally down", third: "3rd hit" };
const GATE_WORDS: Record<Gate, string> = { low: "Low HP", alone: "Alone" };
const STAT_WORDS: Record<Stat, string> = { attack: "attack", guard: "guard", speed: "speed", critical: "crit", luck: "luck", haste: "speed" };

/** What one effect does, in two or three words: "hit all", "shield team", "foe speed down". */
function effectWords(effect: Effect): string {
  const many = effect.aim === "foes" || effect.aim === "allies";
  const weakest = effect.aim === "weakest-foe" || effect.aim === "weakest-ally";
  const reach = many ? " all" : weakest ? " weakest" : effect.aim === "blast" ? " around" : "";
  if (effect.kind === "damage") return effect.aim === "foe" ? "extra hit" : `hit${reach}`;
  if (effect.kind === "shield") return `shield${reach}`;
  if (effect.kind === "heal") return `heal${reach}`;
  if (effect.kind === "condition") return CONDITION_NAMES[effect.condition];
  if (effect.kind === "issue") return "open issue";
  const whose = effect.aim === "self" ? "" : effect.aim.endsWith("foe") || effect.aim === "foes" ? "foe " : "team ";
  return `${whose}${STAT_WORDS[effect.stat]} ${effect.by < 0 ? "down" : "up"}`;
}

/**
 * The card a fight shows over a creature when one of its abilities, set bonuses or
 * boosts fires (docs/GAME-UI.md §9): its name, and "Trigger → effect" in a few words.
 * A condition has no trigger of its own, so its line is null.
 */
export function popOf(id: string): Source & { line: string | null } {
  const source = sourceOf(id);
  const hook = hookOf(id);
  if (!hook) return { ...source, line: null };
  const trigger = hook.when ? GATE_WORDS[hook.when] : TRIGGER_WORDS[hook.on];
  const effect = effectWords(hook.effects[0]);
  return { ...source, line: `${trigger} → ${effect.charAt(0).toUpperCase()}${effect.slice(1)}` };
}

/** What the ability, set bonus or boost behind an event's id does, in order; a set's are its two-card bonus. An unknown id does nothing. */
export const effectsOf = (id: string): Effect[] => hookOf(id)?.effects ?? [];

/** When the thing behind an event's id fires and what it does first; a set's words are its two-card bonus. */
function hookOf(id: string): { on: Trigger; when?: Gate; effects: Effect[] } | null {
  if (id.startsWith("set:")) return bonusOf(id.slice("set:".length)).tiers[0];
  if (id.startsWith("boost:")) return boostById(id.slice("boost:".length)) ?? null;
  if (id.startsWith("class:")) return classHookOf(id.slice("class:".length));
  return abilityById(id) ?? null;
}

/** A class's hook as words read it; an effect that depends on the team is read for an empty one. */
function classHookOf(klass: string): { on: Trigger; effects: Effect[] } | null {
  const effect = klass in CLASS_EFFECTS ? CLASS_EFFECTS[klass as keyof typeof CLASS_EFFECTS] : undefined;
  if (!effect) return null;
  return { on: effect.on, effects: typeof effect.effects === "function" ? effect.effects({ login: "", round: 0, units: [], boosts: [] }) : effect.effects };
}
