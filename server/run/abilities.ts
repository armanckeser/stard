import { seededRandom, type CardType } from "../battle.ts";
import type { Effect, Gate, Hook, Trigger } from "./hooks.ts";
import type { Signals } from "./stats.ts";

// One ability per card, named for GitHub life. Each fires by a rule (hooks.ts) and does
// something plain: damage, heal, shield, a stat change, or one of the four conditions.
// A repo qualifies for an ability by its facts; among the ones it qualifies for, its
// name picks one, so the same repo always has the same ability.

export type Ability = {
  id: string;
  name: string;
  /** What the card shows. */
  text: string;
  on: Trigger;
  when?: Gate;
  once?: boolean;
  effects: Effect[];
  /** The repo facts that qualify a card for this ability. */
  fits: (repo: Signals) => boolean;
};

const DAY_7 = 7;
const QUIET_YEAR = 365;

export const ABILITIES: Ability[] = [
  // At the start of the fight.
  { id: "cache-hit", name: "Cache hit", text: "Fight start: gain 60% speed.", on: "start", effects: [{ kind: "stat", aim: "self", stat: "speed", by: 0.6 }], fits: (repo) => /cache|fast|speed|perf|quick/.test(repo.name) || repo.type === "data" },
  { id: "fork-bomb", name: "Fork bomb", text: "Fight start: hit all enemies for 60%.", on: "start", effects: [{ kind: "damage", aim: "foes", power: 0.6 }], fits: (repo) => repo.forks >= 500 },
  { id: "code-freeze", name: "Code freeze", text: "Fight start: gain a 22% HP shield.", on: "start", effects: [{ kind: "shield", aim: "self", share: 0.22 }], fits: (repo) => repo.archived || repo.daysQuiet > QUIET_YEAR },
  { id: "bus-factor", name: "Bus factor", text: "Fight start: gain 70% attack, lose 10% guard.", on: "start", effects: [{ kind: "stat", aim: "self", stat: "attack", by: 0.7 }, { kind: "stat", aim: "self", stat: "guard", by: -0.1 }], fits: (repo) => repo.contributors <= 1 },
  { id: "monorepo", name: "Monorepo", text: "Fight start: team gains a 5% HP shield.", on: "start", effects: [{ kind: "shield", aim: "allies", share: 0.05 }], fits: (repo) => repo.contributors >= 200 },

  // After each of the card's hits.
  { id: "review-swarm", name: "Review swarm", text: "On attack: hit again for 20%.", on: "hit", effects: [{ kind: "damage", aim: "foe", power: 0.2 }], fits: (repo) => repo.contributors >= 50 },
  { id: "open-issues", name: "Open issues", text: "On attack: open an issue on the target. Each open issue costs 1% HP a second, until a heal closes them all.", on: "hit", effects: [{ kind: "issue", aim: "foe" }], fits: (repo) => repo.openIssues >= 50 && repo.closeRate < 0.5 },
  { id: "cherry-pick", name: "Cherry pick", text: "On attack: nick the weakest enemy.", on: "hit", effects: [{ kind: "damage", aim: "weakest-foe", power: 0.3 }], fits: (repo) => repo.stars > 20 && repo.forks / repo.stars >= 0.3 },

  // After the card is hit and still standing.
  { id: "hotfix", name: "Hotfix", text: "Once, at 50% HP: heal 30%.", on: "hurt", when: "low", once: true, effects: [{ kind: "heal", aim: "self", share: 0.3 }], fits: (repo) => repo.daysQuiet <= DAY_7 },
  { id: "rate-limit", name: "Rate limit", text: "When hit: rate-limit the attacker.", on: "hurt", effects: [{ kind: "condition", aim: "foe", condition: "rate-limited" }], fits: (repo) => /api|http|client|sdk|fetch|request|proxy|server/.test(repo.name) },
  { id: "add-tests", name: "Add tests", text: "When hit: gain 9% guard.", on: "hurt", effects: [{ kind: "stat", aim: "self", stat: "guard", by: 0.09 }], fits: (repo) => repo.closedIssues >= 20 && repo.closeRate >= 0.8 },
  { id: "rubber-duck", name: "Rubber duck", text: "When hit: gain a 2.5% HP shield.", on: "hurt", effects: [{ kind: "shield", aim: "self", share: 0.025 }], fits: (repo) => repo.type === "docs" },
  { id: "revert", name: "Revert", text: "When hit: hit back for 30%.", on: "hurt", effects: [{ kind: "damage", aim: "foe", power: 0.3 }], fits: (repo) => repo.releases >= 20 },

  // When a teammate faints.
  { id: "on-call", name: "On call", text: "Ally faints: gain 60% attack, heal 10%.", on: "ally-faint", effects: [{ kind: "stat", aim: "self", stat: "attack", by: 0.6 }, { kind: "heal", aim: "self", share: 0.1 }], fits: (repo) => repo.contributors >= 2 && repo.contributors <= 10 },
  { id: "postmortem", name: "Postmortem", text: "Ally faints: team heals 12%.", on: "ally-faint", effects: [{ kind: "heal", aim: "allies", share: 0.12 }], fits: (repo) => repo.closedIssues >= 500 },
  { id: "good-first-issue", name: "Good first issue", text: "Ally faints: team gains 25% attack.", on: "ally-faint", effects: [{ kind: "stat", aim: "allies", stat: "attack", by: 0.25 }], fits: (repo) => repo.stars < 100 && repo.contributors >= 3 },
  { id: "hard-fork", name: "Hard fork", text: "Ally faints: gain a 25% HP shield.", on: "ally-faint", effects: [{ kind: "shield", aim: "self", share: 0.25 }], fits: (repo) => repo.stars > 20 && repo.forks >= repo.stars / 2 },

  // On every third hit.
  { id: "force-push", name: "Force push", text: "Every 3rd attack: hit again for 120%.", on: "third", effects: [{ kind: "damage", aim: "foe", power: 1.2 }], fits: (repo) => repo.yearly >= 1000 },
  { id: "rebase", name: "Rebase", text: "Every 3rd attack: heal 10%.", on: "third", effects: [{ kind: "heal", aim: "self", share: 0.1 }], fits: (repo) => repo.age < 1 },
  { id: "green-build", name: "Green build", text: "Every 3rd attack: heal the weakest ally 5%.", on: "third", effects: [{ kind: "heal", aim: "weakest-ally", share: 0.05 }], fits: (repo) => repo.releases >= 10 },
  { id: "blast-radius", name: "Blast radius", text: "Every 3rd attack: hit the target and every enemy next to it for 50%.", on: "third", effects: [{ kind: "damage", aim: "blast", power: 0.5 }], fits: (repo) => /core|kernel|engine|runtime|framework|platform/.test(repo.name) },
  { id: "star-storm", name: "Star storm", text: "Every 3rd attack: hit all enemies for 25%.", on: "third", effects: [{ kind: "damage", aim: "foes", power: 0.25 }], fits: (repo) => repo.stars >= 10_000 },
  { id: "breaking-change", name: "Breaking change", text: "Every 3rd attack: cause a merge conflict.", on: "third", effects: [{ kind: "condition", aim: "foe", condition: "merge-conflict" }], fits: (repo) => repo.releases >= 30 },
  { id: "stale-bot", name: "Stale bot", text: "Every 3rd attack: make the target flaky.", on: "third", effects: [{ kind: "condition", aim: "foe", condition: "flaky" }], fits: (repo) => repo.openIssues >= 200 },
  { id: "legacy-code", name: "Legacy code", text: "Every 3rd attack: rate-limit the target.", on: "third", effects: [{ kind: "condition", aim: "foe", condition: "rate-limited" }], fits: (repo) => repo.age >= 8 },
  { id: "dependabot", name: "Dependabot", text: "Every 3rd attack: deprecate the target.", on: "third", effects: [{ kind: "condition", aim: "foe", condition: "deprecated" }], fits: (repo) => repo.yearly >= 300 },
];

/** The ability a repo gets when it qualifies for none. */
const BY_TYPE: Record<CardType, string> = {
  systems: "legacy-code",
  scripts: "rate-limit",
  web: "cache-hit",
  apps: "on-call",
  data: "green-build",
  docs: "rubber-duck",
};

const BY_ID = new Map(ABILITIES.map((ability) => [ability.id, ability]));

export const abilityById = (id: string): Ability | undefined => BY_ID.get(id);

/** One of the abilities the repo qualifies for, picked by its full name. */
export function abilityFor(repo: Signals, fullName: string): string {
  const fitting = ABILITIES.filter((ability) => ability.fits(repo));
  if (fitting.length === 0) return BY_TYPE[repo.type];
  return fitting[Math.floor(seededRandom(`ability|${fullName.toLowerCase()}`)() * fitting.length)].id;
}

/** The hooks a card carries for its ability. An unknown id carries none. */
export function abilityHooks(id: string): Hook[] {
  const ability = BY_ID.get(id);
  return ability ? [{ source: ability.id, on: ability.on, when: ability.when, once: ability.once, effects: ability.effects }] : [];
}
