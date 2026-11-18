import { readdirSync } from "node:fs";
import { join } from "node:path";
import { CLASS_IDS } from "../../server/character.ts";
import { fight } from "../../server/run/fight.ts";
import { draftTeam, opponentTeam, LEVELS } from "../../server/run/opponent.ts";
import { LOSSES_TO_END, OPPONENTS, WINS_TO_FINISH, freeCell, opponentLogin, shuffled, snapshot, winnerOf, type Unit, type RunFighter } from "../../server/run/rules.ts";
import { loadPool } from "./pools.ts";

// How often a player who builds well wins each round, and a whole run, against the
// opponents the game fields (server/run/opponent.ts): every pool in a folder plays as
// the player in turn, against the others.
//   node scripts/balance/ramp.ts <folder of pool files> [strength,by,round]

const RUNS = Number(process.env.RUNS ?? 200);
const [folder, override] = process.argv.slice(2);
const strength = override ? override.split(",").map(Number) : LEVELS[LEVELS.length - 1];
const pools = readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => loadPool(join(folder, name)));
const byLogin = new Map(pools.map((pool) => [pool.login.toLowerCase(), pool]));
const classes = CLASS_IDS.filter((id) => id !== "rookie");

const placed = (fighters: RunFighter[]): Unit[] => {
  const units: Unit[] = [];
  for (const fighter of fighters) {
    const cell = freeCell(units, fighter);
    if (cell) units.push({ fighter, ...cell });
  }
  return units;
};

const MAX_ROUND = WINS_TO_FINISH + LOSSES_TO_END - 1;
const wonAt = Array.from({ length: MAX_ROUND + 1 }, () => ({ won: 0, played: 0 }));
let runsWon = 0;
let runs = 0;
for (const player of pools) {
  for (let i = 0; i < RUNS; i++) {
    const seed = `ramp${i}`;
    const klass = shuffled(classes, `${player.login}|${seed}|mine`)[0];
    let wins = 0;
    let losses = 0;
    for (let round = 1; wins < WINS_TO_FINISH && losses < LOSSES_TO_END; round++) {
      const others = OPPONENTS.filter((login) => byLogin.has(login));
      const login = opponentLogin(player.login, round, seed, OPPONENTS.filter((name) => !others.includes(name)));
      const opponent = byLogin.get(login)!;
      const mine = draftTeam(player, round, seed);
      const theirs = opponentTeam(opponent, "rookie", round, seed, strength);
      const a = snapshot(player.login, round, placed(mine.board), mine.boosts, klass);
      const b = snapshot(login, round, theirs.units, theirs.boosts, theirs.klass);
      const won = winnerOf(fight(a, b, `${player.login}|${login}|${round}|${seed}`)) === 0;
      wonAt[round].played++;
      if (won) wonAt[round].won++;
      if (won) wins++;
      else losses++;
    }
    runs++;
    if (wins >= WINS_TO_FINISH) runsWon++;
  }
}
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
console.log(`strength ${strength.join(",")}: ${pools.length} pools x ${RUNS} runs`);
console.log(wonAt.slice(1, 6).map((at, i) => `r${i + 1} ${pct(at.won / at.played)}`).join("  "), ` runs won ${pct(runsWon / runs)}`);
