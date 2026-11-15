import { abilityHooks } from "./abilities.ts";
import { boostHooks } from "./boosts.ts";
import { classHooks } from "./classes.ts";
import type { Rules } from "./hooks.ts";
import { setHooks } from "./sets.ts";

/** The game's rules: each card carries its ability, then its set bonuses, then the team's boosts, then its player's class. */
export const GAME_RULES: Rules = {
  hooks: (snapshot) => {
    const sets = setHooks(snapshot);
    const boosts = boostHooks(snapshot);
    const klass = classHooks(snapshot);
    return snapshot.units.map((placed, index) => [...abilityHooks(placed.card.ability), ...sets[index], ...boosts[index], ...klass[index]]);
  },
};
