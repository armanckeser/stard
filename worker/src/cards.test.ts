import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { fakeGitHubWhere } from "./fake-github.test-helper.ts";
import { callWorker, memoryCaches } from "./worker-host.test-helper.ts";

// The card routes, through the Worker's own router, so a card that draws but isn't routed fails here.

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: new Uint8Array() }));
vi.mock("./SpaceGrotesk-Bold.ttf", () => ({ default: new ArrayBuffer(0) }));

beforeEach(() => {
  const github = fakeGitHubWhere({ noPlay: [] });
  vi.stubGlobal("caches", memoryCaches());
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : String(input);
    return address === "https://api.github.com/graphql" ? github.fetch(input, init) : new Response(null, { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

test("a matchup card is served at its address and needs no user", async () => {
  const { status, text } = await callWorker("/api/card/matchup.svg?a=greendale/dreamatorium&b=cougar-town/kickpuncher&title=study+aids");
  expect(status).toBe(200);
  expect(text).toContain("MATCHUP · STUDY AIDS");
});

test("a matchup of one repo against itself says what it needs", async () => {
  const { status, text } = await callWorker("/api/card/matchup.svg?a=greendale/dreamatorium&b=greendale/dreamatorium");
  expect(status).toBe(400);
  expect(text).toContain("two different repos");
});
