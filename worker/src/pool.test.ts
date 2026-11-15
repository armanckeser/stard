import { afterEach, describe, expect, test, vi } from "vitest";
import type { RunPool } from "./battle.ts";
import { poolResponse } from "./battle.ts";
import { COLLECTOR, GUEST, HOST, PRIVATE_DECK, STRONG_DECK, fakeGitHub } from "./fake-github.test-helper.ts";

// Run card HP is 130 plus a quarter of the HP share, and a share is at most 40% of the
// biggest budget (460), so no run card passes 176 HP, or 185 when shiny. Battle cards
// for the same repos run near 300 HP.
const RUN_HP_FLOOR = 130;
const RUN_HP_CEILING = 185;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/run/pool", () => {
  // Regression guarded: the Play screen fought with battle numbers (about 300 HP), so a
  // third of fights ran out the clock, and the board's HP bars disagreed with the fight.
  test("deals each card with its run card, and the fighter shows the run card's numbers", async () => {
    vi.stubGlobal("fetch", fakeGitHub);
    const response = await poolResponse(new URLSearchParams({ login: HOST }), "a-token");
    const pool = (await response.json()) as RunPool;

    expect(response.status).toBe(200);
    expect(pool.team.length).toBeGreaterThan(0);
    for (const fighter of pool.team) {
      expect(fighter.card.fullName).toBe(fighter.fullName);
      expect(fighter.card.hp).toBeGreaterThanOrEqual(RUN_HP_FLOOR);
      expect(fighter.card.hp).toBeLessThanOrEqual(RUN_HP_CEILING);
      expect([fighter.hp, fighter.attack, fighter.defense, fighter.speed]).toEqual([fighter.card.hp, fighter.card.attack, fighter.card.guard, fighter.card.speed]);
    }
  });

  // Regression guarded: the account query also read every pinned and top repo's facts
  // (commit history, contributors), and for a busy account (antfu: 10.6 s) it ran into
  // GitHub's 10-second limit, so the pool failed with a 502 and the round couldn't open.
  test("reads the account by repo names only, and still deals the pinned ace with its facts", async () => {
    const queries: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      queries.push((JSON.parse(String(init?.body)) as { query: string }).query);
      return fakeGitHub(input, init);
    });
    const response = await poolResponse(new URLSearchParams({ login: GUEST }), "a-token");
    const pool = (await response.json()) as RunPool;

    const accountQuery = queries.find((query) => query.includes("user(login:"));
    expect(accountQuery).toBeDefined();
    expect(accountQuery).not.toContain("history");
    expect(accountQuery).not.toContain("mentionableUsers");
    expect(pool.facts.ace).toBe("greendale/paintball-assassin");
    const [ace, ...drawn] = pool.team.map((fighter) => [fighter.fullName, fighter.stars]);
    expect(ace).toEqual(["greendale/paintball-assassin", 9100]);
    // The draw's order changes with the day; which cards and their facts don't.
    expect(drawn.sort()).toEqual([
      ["city-college/mascot", 1900],
      ["greendale/human-being", 75],
    ]);
  });

  test("refuses a username GitHub can't have", async () => {
    vi.stubGlobal("fetch", fakeGitHub);
    const response = await poolResponse(new URLSearchParams({ login: "not a login" }), "a-token");

    expect(response.status).toBe(400);
  });

  describe("with a deck", () => {
    const deckOf = async (deck: string) => {
      vi.stubGlobal("fetch", fakeGitHub);
      const response = await poolResponse(new URLSearchParams({ login: COLLECTOR, deck }), "a-token");
      return { status: response.status, body: (await response.json()) as RunPool & { error?: string } };
    };
    // The collector's 36-repo List holds every star of 5,000 and up, so a pool drawn
    // straight from it would be all rare and legendary cards.
    const strong = (pool: RunPool) => pool.team.slice(1).filter((fighter) => fighter.stars >= 5000).length;

    // Guards the rule that stops a strong List becoming an unbeatable deck: a List fills
    // at most half the pool, and the stars draw doesn't add more of the List's repos.
    test("fills half the pool after the ace from the List, and the rest from other stars", async () => {
      const { status, body } = await deckOf(STRONG_DECK);

      expect(status).toBe(200);
      expect(body.deck).toBe(STRONG_DECK);
      expect(strong(body)).toBe(20);
      // The ace, 20 from the List, and all 13 stars outside it: short of 40 rather than more of the List.
      expect(body.team).toHaveLength(1 + 20 + 13);
    });

    test("deals the same pool without a deck as before", async () => {
      vi.stubGlobal("fetch", fakeGitHub);
      const pool = (await (await poolResponse(new URLSearchParams({ login: COLLECTOR }), "a-token")).json()) as RunPool;

      expect(pool.deck).toBeUndefined();
      expect(pool.team).toHaveLength(40);
      // The decks the Play screen offers: public Lists only, by name and slug.
      expect(pool.decks).toEqual([{ slug: STRONG_DECK, name: "legends" }]);
    });

    // The demo's token is its owner's, which can read the owner's private Lists.
    test("never reads a private List", async () => {
      const { status, body } = await deckOf(PRIVATE_DECK);

      expect(status).toBe(404);
      expect(body.error).toContain(`no public List called ${PRIVATE_DECK}`);
    });

    test("refuses a List the player doesn't have, and a name no List can have", async () => {
      expect((await deckOf("study-group-yearbook")).status).toBe(404);
      expect((await deckOf("no spaces")).status).toBe(400);
    });
  });
});
