import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { HOST, NOBODY, STARGAZER, fakeGitHubWhere, type FakeGitHub } from "./fake-github.test-helper.ts";
import { callWorker, memoryCaches } from "./worker-host.test-helper.ts";

// "Your 2026 in stars" through the Worker's own router (worker/src/wrapped.ts), with
// GitHub and the static site faked at the network. Every account is invented.

vi.mock("@resvg/resvg-wasm/index_bg.wasm", () => ({ default: new Uint8Array() }));
vi.mock("./SpaceGrotesk-Bold.ttf", () => ({ default: new ArrayBuffer(0) }));

const SITE_PAGE = "<!doctype html><html><head><title>Stard</title></head><body></body></html>";

let github: FakeGitHub;
// Points GitHub says are left, sent with each GraphQL reply.
let pointsLeft = 5000;

beforeEach(() => {
  pointsLeft = 5000;
  github = fakeGitHubWhere({ noPlay: [] });
  vi.stubGlobal("caches", memoryCaches());
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const address = input instanceof Request ? input.url : String(input);
    if (address === "https://api.github.com/graphql") {
      const reply = await github.fetch(input, init);
      const headers = new Headers(reply.headers);
      headers.set("x-ratelimit-remaining", String(pointsLeft));
      headers.set("x-ratelimit-reset", String(Math.floor(Date.now() / 1000) + 600));
      return new Response(reply.body, { status: reply.status, headers });
    }
    // The static host answers a page it has no file for with its fallback page and a 404.
    if (address.includes("/list/")) return new Response(SITE_PAGE, { status: 404, headers: { "Content-Type": "text/html" } });
    return new Response(null, { status: 404 });
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("a Wrapped page", () => {
  test("shows the year with the tags a link preview reads, and leads to the organizer", async () => {
    const { status, text } = await callWorker(`/wrapped/${HOST}`);
    expect(status).toBe(200);
    expect(text).toContain(`<meta property="og:image" content="https://stard.armanckeser.com/api/card/wrapped.png?user=${HOST}">`);
    expect(text).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(text).toContain("3 repos, mostly JavaScript, peak in August. 33% are still alive");
    expect(text).toContain(`href="/?user=${HOST}">Now sort these 3 stars into Lists`);
    expect(text).toContain("https://bsky.app/intent/compose?text=");
    expect(text).toContain("https://x.com/intent/tweet?text=");
    expect(text).toContain(`[![2026 in stars](https://stard.armanckeser.com/api/card/wrapped.svg?user=${HOST})](https://stard.armanckeser.com/wrapped/${HOST})`);
  });

  test("says there is no such user, with a 404", async () => {
    const { status, text } = await callWorker(`/wrapped/${NOBODY}`);
    expect(status).toBe(404);
    expect(text).toContain(`No GitHub user called ${NOBODY}`);
  });

  test("sends the Make yours box to the typed user's page", async () => {
    const { status, headers } = await callWorker("/wrapped?user=%40study-group-annie");
    expect(status).toBe(302);
    expect(headers.get("Location")).toBe("https://stars-demo.example/wrapped/study-group-annie");
  });

  test("reads GitHub once for the page and its card", async () => {
    // Regression guarded: each of the page, the SVG and the PNG reading up to 10 pages of stars on the shared token.
    await callWorker(`/wrapped/${HOST}`);
    await callWorker(`/api/card/wrapped.svg?user=${HOST}`);
    await callWorker(`/api/card/wrapped.svg?user=${HOST.toUpperCase()}`);
    expect(github.usersRead).toEqual([HOST]);
  });
});

describe("the Wrapped card", () => {
  test("is served for a README", async () => {
    const { status, text, headers } = await callWorker(`/api/card/wrapped.svg?user=${HOST}`);
    expect(status).toBe(200);
    expect(headers.get("Content-Type")).toContain("image/svg+xml");
    expect(text).toContain("2026 IN GITHUB STARS");
  });

  test("reads no more than 10 pages and shows the count as 1,000+", async () => {
    const { text } = await callWorker(`/api/card/wrapped.svg?user=${STARGAZER}`);
    expect(text).toContain(">1,000+</text>");
    expect(github.usersRead.length).toBe(10);
  });

  test("says when to come back while GitHub's points are low, and keeps nothing", async () => {
    pointsLeft = 20;
    // Any reply tells the Worker how many points are left.
    await callWorker(`/api/card/wrapped.svg?user=${HOST}`);
    const { status, text, headers } = await callWorker("/api/card/wrapped.svg?user=study-group-annie");
    expect(status).toBe(503);
    expect(text).toMatch(/GitHub is busy\. Try again in \d+ minutes\./);
    expect(headers.get("Cache-Control")).toBe("no-store");
  });
});

test("a shared List's page is the app, with a 200", async () => {
  // Regression guarded: /list/<id> answering with the static host's 404, so link checkers called shared Lists dead.
  const { status, text } = await callWorker("/list/UL_study-group-britta_legends");
  expect(status).toBe(200);
  expect(text).toBe(SITE_PAGE);
});
