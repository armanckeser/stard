import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { fight } from "../../server/run/fight.ts";
import { opponentTeam, LEVELS } from "../../server/run/opponent.ts";
import { snapshot, winnerOf } from "../../server/run/rules.ts";
import { savedSnapshotAt, type SavedTeam } from "../../server/run/saved-team.ts";
import { loadPool } from "./pools.ts";

// How often teams real people built win each round against the opponents the game fields.
// Each saved team fights every opponent pool at the round it was played, over SEEDS runs.
//   cd worker && npx wrangler d1 execute stard --remote --json --command "SELECT token FROM team_links" > links.json
//   node scripts/balance/replay.ts links.json <folder of pools> [strength,by,round]
// A team link's token is the team, signed: the part before the dot, deflated, is plain JSON.

const SEEDS = Number(process.env.SEEDS ?? 30);
const [linksFile, folder, override] = process.argv.slice(2);
const strength = override ? override.split(",").map(Number) : LEVELS[LEVELS.length - 1];
const pools = readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => loadPool(join(folder, name)));
const rows = (JSON.parse(readFileSync(linksFile, "utf8")) as { results: { token: string }[] }[])[0].results;
const teamOf = (token: string) => JSON.parse(inflateRawSync(Buffer.from(token.split(".")[0], "base64url")).toString()) as SavedTeam;
// Only finished runs of five rounds or more: a team that lost early never met the late rounds.
const teams = rows.map((row) => teamOf(row.token)).filter((team) => team.rounds.length >= 5);

const line: string[] = [];
for (let round = 1; round <= 5; round++) {
  let won = 0;
  let played = 0;
  teams.forEach((team, t) => {
    for (const opponent of pools.filter((pool) => pool.login.toLowerCase() !== team.login.toLowerCase())) {
      for (let i = 0; i < SEEDS; i++) {
        const seed = `replay${t}|${i}`;
        const theirs = opponentTeam(opponent, "rookie", round, seed, strength);
        const b = snapshot(opponent.login, round, theirs.units, theirs.boosts, theirs.klass);
        won += Number(winnerOf(fight(savedSnapshotAt(team, round), b, `${seed}|${opponent.login}|${round}`)) === 0);
        played++;
      }
    }
  });
  line.push(`r${round} ${((won / played) * 100).toFixed(0)}%`);
}
console.log(`strength ${strength.join(",")}: ${teams.length} saved teams`);
console.log(line.join("  "));
