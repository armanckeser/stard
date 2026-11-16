import { Hono } from "hono";
import { battleResponse, gql, poolResponse } from "../../worker/src/battle.ts";
import { OptedOut, checkPoolRead, opponentsBody, readOptOuts, type OptOuts } from "../../worker/src/no-play.ts";
import { readPopular, type PopularList, type SearchNodes } from "../../worker/src/popular.ts";

// The Play and Battle screens' reads, answered here with the player's own token by the
// hosted Worker's code (worker/src/battle.ts), so this app spends none of the Worker's
// GitHub points, still plays when the Worker says it's busy, and tells the website nothing.
//   GET /api/run/pool?login=<login>&for=<login>   an account's 40 cards
//   GET /api/run/opponents                        who asked not to be played
//   GET /api/battle?a=<login>&b=<login>           an instant battle

const NO_BLOCK_LIST: ReadonlySet<string> = new Set();

export function runReads(token: string): Hono {
  const api = new Hono();
  const optOuts: OptOuts = (logins) => readOptOuts(token, logins);
  // The popular repos that top up a small account: one search per launch, read again after a failure.
  let popular: Promise<PopularList> | null = null;
  const readPopularOnce = () => {
    popular ??= readPopular((query) => gql<Record<string, SearchNodes>>(token, query), Date.now()).catch((error: unknown) => {
      popular = null;
      throw error;
    });
    return popular;
  };

  api.get("/run/pool", async (c) => {
    const params = new URL(c.req.url).searchParams;
    try {
      await checkPoolRead(params, optOuts, NO_BLOCK_LIST);
    } catch (error) {
      if (error instanceof OptedOut) return c.json({ error: error.message }, error.status as 403);
      throw error;
    }
    return poolResponse(params, token, readPopularOnce);
  });

  api.get("/run/opponents", async (c) => c.json(await opponentsBody(optOuts)));
  api.get("/battle", (c) => battleResponse("battle", new URL(c.req.url).searchParams, token));
  return api;
}
