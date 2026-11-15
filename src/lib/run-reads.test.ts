// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { poolFor } from "../../e2e/pool";
import { OPPONENTS } from "../../server/run/rules";

// What the Play screen reads from the Worker as a run starts and each round opens, against
// a Worker answered in the test. These were browser tests; none of them needs a screen.

type Worker = { optedOut: string[]; pools: URLSearchParams[]; refuseDeck?: boolean };
let worker: Worker;

beforeEach(() => {
  // Each test gets fresh modules: run.ts keeps a page-long cache of pools and the opt-out list.
  vi.resetModules();
  localStorage.clear();
  worker = { optedOut: [], pools: [] };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/api/run/opponents") return Response.json({ optedOut: worker.optedOut });
    if (url.pathname === "/api/run/pool") {
      worker.pools.push(url.searchParams);
      if (worker.refuseDeck && url.searchParams.has("deck")) return Response.json({ error: "web-tools is no public List of abed's." }, { status: 404 });
      return Response.json(poolFor(url.searchParams.get("login")!));
    }
    return Response.json({ error: "not stubbed" }, { status: 500 });
  });
});

afterEach(() => vi.unstubAllGlobals());

const reads = () => import("./run-reads");
const poolLogins = () => new Set(worker.pools.map((params) => params.get("login")));

describe("starting a run", () => {
  it("reads round 2's opponent while round 1 is played, so Continue finds it waiting", async () => {
    // Regression guarded: the next opponent was read only once Continue was pressed, so every
    // round opened on "Reading the next team..." for as long as a cold read takes.
    const { readRun } = await reads();
    const action = await readRun("abed", "greendale", undefined);
    expect(action.type).toBe("run-read");
    // abed's own cards, round 1's opponent and round 2's.
    await vi.waitFor(() => expect(poolLogins().size).toBe(3));
  });

  it("never deals an opponent who opted out", async () => {
    // Regression guarded: the Play screen fighting an account that asked not to be played
    // against (OPPONENTS.md), when the opt-out list isn't applied to the opponent pick.
    worker.optedOut = OPPONENTS.filter((login) => login !== "simonw");
    const { readRun } = await reads();
    const action = await readRun("abed", "greendale", undefined);
    expect(action.type === "run-read" && action.opponent.login).toBe("simonw");
    await vi.waitFor(() => expect(poolLogins()).toEqual(new Set(["abed", "simonw"])));
  });

  it("deals the run with the deck, ace and class picked in Customize", async () => {
    const { pickFor } = await import("./choices");
    const ace = poolFor("abed").team[1].fullName;
    pickFor("abed", { deck: "web-tools", ace, klass: "scout" });
    const { readRun } = await reads();
    const action = await readRun("abed", "greendale", undefined);
    const own = worker.pools.find((params) => params.get("login") === "abed")!;
    expect(own.get("deck")).toBe("web-tools");
    expect(own.get("ace")).toBe(ace);
    expect(action.type === "run-read" && action.player.character.klass).toBe("scout");
  });

  it("lets go of a deck that is gone and deals from all the stars", async () => {
    const { choicesFor, pickFor } = await import("./choices");
    pickFor("abed", { deck: "web-tools" });
    worker.refuseDeck = true;
    const { readRun } = await reads();
    const action = await readRun("abed", "greendale", undefined);
    expect(action.type).toBe("run-read");
    expect(choicesFor("abed").deck).toBeUndefined();
  });

  it("says what failed when the cards can't be read", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ error: "No GitHub user called abed." }, { status: 404 }));
    const { readRun } = await reads();
    expect(await readRun("abed", "greendale", undefined)).toMatchObject({ type: "read-failed", message: "No GitHub user called abed." });
  });
});
