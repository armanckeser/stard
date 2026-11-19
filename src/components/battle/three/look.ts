/**
 * How much a fight writes on the board, while the owner tries three looks on real runs:
 * "today" (effects and icons, numbers only on crits and heals), "gif" (the README GIF's:
 * every ability named over its card, a number on every hit, conditions as words) and
 * "middle" (today's, plus small hit numbers, a name over a card at most every few seconds,
 * a condition's word the first time it lands, and a bigger ranged shot).
 * `?look=gif` picks one and the browser keeps it; `?look=today` goes back.
 */
export type FightLook = "today" | "gif" | "middle";

const KEY = "stard.look";
const LOOKS: FightLook[] = ["today", "gif", "middle"];
const isLook = (value: string | null): value is FightLook => LOOKS.includes(value as FightLook);

export function fightLook(): FightLook {
  try {
    const asked = new URLSearchParams(location.search).get("look");
    if (isLook(asked)) localStorage.setItem(KEY, asked);
    const kept = localStorage.getItem(KEY);
    return isLook(kept) ? kept : "today";
  } catch {
    return "today";
  }
}
