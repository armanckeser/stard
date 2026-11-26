import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { battleDay, battleResponse } from "./battle.ts";
import { GUEST, HOST, fakeGitHub } from "./fake-github.test-helper.ts";

// A shared battle link names its day (`d`), so the fight it shows is the one that was shared.

const NOV_1 = Date.UTC(2026, 10, 1, 9);
const DAY_MS = 24 * 3600 * 1000;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.stubGlobal("fetch", fakeGitHub);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

type Side = { team: unknown[] };
type Fight = { day: string; seed: string; a: Side; b: Side; result: unknown };
// What a viewer sees of a battle: the day, both teams' cards and every hit. When GitHub was read is left out.
async function fight(at: number, d?: string): Promise<Fight> {
  vi.setSystemTime(at);
  const response = await battleResponse("battle", new URLSearchParams({ a: HOST, b: GUEST, ...(d ? { d } : {}) }), "token");
  expect(response.status).toBe(200);
  const { day, seed, a, b, result } = (await response.json()) as Fight;
  return { day, seed, a: { team: a.team }, b: { team: b.team }, result };
}

describe("a battle's day", () => {
  // Regression guarded: a post saying who won a shared battle showing the other side winning the next day.
  test("a link with a day shows the same fight on a later day", async () => {
    const shared = await fight(NOV_1);
    expect(shared.day).toBe("2026-11-01");
    const later = await fight(NOV_1 + 9 * DAY_MS, shared.day);
    expect(later).toEqual(shared);
  });

  // Regression guarded: a player starring more repos after a battle was shared redrawing the shared fight's cards.
  test("stars given after the day leave the fight alone", async () => {
    const shared = await fight(NOV_1);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = (await (await fakeGitHub(input, init)).json()) as { data?: { user?: { starredRepositories?: { edges: unknown[] } } } };
      body.data?.user?.starredRepositories?.edges.unshift({ starredAt: "2026-11-05T10:00:00Z", node: { nameWithOwner: "greendale/paintball-assassin", isPrivate: false } });
      return Response.json(body);
    });
    expect(await fight(NOV_1 + 9 * DAY_MS, shared.day)).toEqual(shared);
    expect(await fight(NOV_1 + 9 * DAY_MS)).not.toMatchObject({ a: shared.a });
  });

  test("a link with no day draws for today", async () => {
    const shared = await fight(NOV_1);
    const later = await fight(NOV_1 + 9 * DAY_MS);
    expect(later.day).toBe("2026-11-10");
    expect(later.seed).not.toBe(shared.seed);
  });

  // Regression guarded: a link shared in the evening showing other numbers than the fight seen that morning.
  test("the fight holds all day", async () => {
    expect(await fight(NOV_1 + 12 * 3600 * 1000)).toEqual(await fight(NOV_1));
  });

  test.each(["2026-11-02", "2026-02-30", "26-11-01", "yesterday"])("refuses %s on 2026-11-01", (d) => {
    expect(battleDay(d, NOV_1)).toBeNull();
  });

  test("takes today, an earlier day, and no day at all", () => {
    expect(battleDay("2026-11-01", NOV_1)).toBe("2026-11-01");
    expect(battleDay("2024-02-29", NOV_1)).toBe("2024-02-29");
    expect(battleDay(null, NOV_1)).toBe("2026-11-01");
  });
});
