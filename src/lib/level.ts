import { LEVELS } from "../../server/run/opponent";

// The level this browser plays at (server/run/opponent.ts): 1 until it has won a run, then
// the next. A private window or cleared site data starts at level 1 again, which only makes
// a run easier, so the note is kept in the browser and nowhere else.

const KEY = "stard:won-a-run";

export function playLevel(): number {
  try {
    return localStorage.getItem(KEY) ? LEVELS.length : 1;
  } catch {
    return 1;
  }
}

export function rememberWin(): void {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    // Without storage the next run is level 1 again.
  }
}
