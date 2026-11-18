import { OPPONENTS } from "../../server/run/rules.ts";
import { gql, poolResponse, type FactsStore, type PoolChoice, type RunPool } from "./battle.ts";
import { DAY, HOUR, cacheKeyFor, readThrough, type CacheDeps, type Lifetime } from "./edge-cache.ts";
import { cachedPopular, type SearchNodes } from "./popular.ts";
import { RunRefused } from "./run.ts";
import { seal, unseal } from "./sealed.ts";

// An account's pool, as the Play screen (GET /api/run/pool) and a run's referee
// (worker/src/run.ts) read it: one way in, one cache entry, so the two can't drift.
//
// A player's own stars should feel fresh, so their pool is read again after an hour.
// The opponents are the same dozen accounts for every player, so their pools are kept
// for a week and then served while a new one is read. An opponent's pool (its 40
// cards, and their numbers as of the read) so changes about weekly; which of those
// cards it fields in a round changes with each run's seed (opponentTeam, server/run/opponent.ts).

const PLAYER_POOL: Lifetime = { fresh: HOUR, keep: HOUR };
const OPPONENT_POOL: Lifetime = { fresh: 7 * DAY, keep: 30 * DAY };
const OPPONENT_LOGINS = new Set<string>(OPPONENTS);

/** What reading a pool needs: the edge cache, the Worker's origin, the GitHub token, and the repo facts every pool shares. */
export type PoolDeps = CacheDeps & { origin: string; token: string; facts?: FactsStore };

/** An account's pool as the reply to GET /api/run/pool, from the edge when it has one, dealt with what the player picked. */
export function poolReply(login: string, deps: PoolDeps, choice: PoolChoice = {}): Promise<Response> {
  const url = new URL("/api/run/pool", deps.origin);
  url.searchParams.set("login", login);
  if (choice.deck) url.searchParams.set("deck", choice.deck);
  if (choice.ace) url.searchParams.set("ace", choice.ace);
  const lifetime = OPPONENT_LOGINS.has(login.toLowerCase()) ? OPPONENT_POOL : PLAYER_POOL;
  const popular = () => cachedPopular((query) => gql<Record<string, SearchNodes>>(deps.token, query), deps.origin, deps);
  return readThrough(cacheKeyFor(url, true), () => poolResponse(url.searchParams, deps.token, popular, deps.facts), lifetime, deps);
}

// A pool's receipt is the pool sealed with BATTLE_KEY. The browser sends it back when it
// saves a team, so the replay (worker/src/team.ts) fights the cards the run fought, not
// a newer read: the edge cache holds a pool per data center and refreshes it while serving the old one.
const POOL_PURPOSE = "stard-pool";

/** A pool reply with its receipt added, when it is a pool and the Worker has a key. */
export async function withReceipt(reply: Response, key: string | undefined): Promise<Response> {
  if (!reply.ok || !key) return reply;
  const pool = (await reply.clone().json()) as RunPool;
  const receipted = new Response(JSON.stringify({ ...pool, receipt: await seal(pool, key, POOL_PURPOSE, "deflated") }), reply);
  receipted.headers.delete("Content-Length");
  return receipted;
}

/** The pool a receipt carries, or null when it isn't one of ours or is `login`'s no longer. */
export async function receiptPool(receipt: string | undefined, key: string, login: string): Promise<RunPool | null> {
  if (!receipt) return null;
  try {
    const pool = (await unseal(receipt, key, POOL_PURPOSE, "deflated")) as RunPool;
    return pool.login.toLowerCase() === login.toLowerCase() ? pool : null;
  } catch {
    return null;
  }
}

/**
 * An account's pool for a run.
 *
 * Raises:
 *   RunRefused: The account can't be played (unknown, no repos), or GitHub didn't answer.
 */
export async function cachedPool(login: string, deps: PoolDeps, choice?: PoolChoice): Promise<RunPool> {
  const response = await poolReply(login, deps, choice);
  const body = (await response.json()) as RunPool & { error?: string };
  if (!response.ok) throw new RunRefused(body.error ?? "GitHub didn't answer. Try again shortly.", response.status);
  return body;
}
