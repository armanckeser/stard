import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeGitHub, unreachable } from "./fake-github.test-helper.ts";
import { repoPages, type RepoPageDeps } from "./repo-page.ts";

// A page per repo, for people who search a repo's stars (worker/src/repo-page.ts).
// GitHub is faked at fetch with invented Greendale repos.

class MemoryCache {
  readonly entries = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.entries.get(new Request(request).url)?.clone();
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.entries.set(new Request(request).url, response.clone());
  }
}

let cache: MemoryCache;
let pending: Promise<unknown>[];

const deps = (): RepoPageDeps => ({ cache, now: Date.parse("2026-11-22T12:00:00Z"), waitUntil: (work) => void pending.push(work), token: "test-token" });
const open = async (path: string) => (await repoPages(new URL(path, "https://stard.example"), deps()))!;

beforeEach(() => {
  cache = new MemoryCache();
  pending = [];
  vi.stubGlobal("fetch", fakeGitHub);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a repo's page", () => {
  test("is HTML a search engine can read: the exact stars, the card's numbers, and a way into a run", async () => {
    const reply = await open("/repo/inspector-spacetime/constables");
    const page = await reply.text();
    expect(reply.status).toBe(200);
    expect(page).toContain("<title>inspector-spacetime/constables: 15,000 GitHub stars · Stard</title>");
    expect(page).toContain('<link rel="canonical" href="https://stard.armanckeser.com/repo/inspector-spacetime/constables">');
    expect(page).toMatch(/<dt>HP<\/dt><dd>\d+<\/dd>/);
    expect(page).toContain("<svg");
    expect(page).toContain('href="/run"');
  });

  test("links to the other most-starred repos, so a crawler finds them all", async () => {
    const page = await (await open("/repo/honda-dealership/sponsor-11")).text();
    expect(page).toContain("number 1 of the most-starred repos");
    expect(page).toContain('href="/repo/honda-dealership/sponsor-10"');
    expect(page).not.toContain('<li><a href="/repo/honda-dealership/sponsor-11"');
  });

  test("moves an address in another case to GitHub's name, so a repo has one page", async () => {
    const reply = await open("/repo/Inspector-Spacetime/CONSTABLES");
    expect(reply.status).toBe(301);
    expect(reply.headers.get("Location")).toBe("https://stard.example/repo/inspector-spacetime/constables");
  });

  test("moves a repo's old name to its new one, as GitHub did facebook/react", async () => {
    const reply = await open("/repo/greendale/old-dreamatorium");
    expect(reply.status).toBe(301);
    expect(reply.headers.get("Location")).toBe("https://stard.example/repo/greendale/dreamatorium");
  });

  test("of a repo GitHub doesn't have is a 404 that asks not to be indexed", async () => {
    const reply = await open("/repo/greendale/no-such-repo");
    expect(reply.status).toBe(404);
    expect(await reply.text()).toContain('<meta name="robots" content="noindex">');
  });
});

test.each(["/repo/inspector-spacetime/constables", "/repo"])("%s isn't kept when GitHub can't be reached, so the next visitor gets a real page", async (path) => {
  vi.stubGlobal("fetch", unreachable);
  expect((await open(path)).status).toBe(502);
  await Promise.all(pending);
  expect([...cache.entries.keys()].filter((key) => key.includes("/repo"))).toEqual([]);
});

test("the list names the most-starred repos, most first", async () => {
  const page = await (await open("/repo")).text();
  expect(page.indexOf("honda-dealership/sponsor-11")).toBeLessThan(page.indexOf("hawthorne-wipes/sponsor-0"));
  expect(page).toContain("★ 200,011");
});

test("the sitemap names the list and every repo on it, at the site's address", async () => {
  const reply = await open("/repo/sitemap.xml");
  const xml = await reply.text();
  expect(reply.headers.get("Content-Type")).toContain("application/xml");
  expect(xml).toContain("<loc>https://stard.armanckeser.com/repo</loc>");
  expect(xml.match(/<loc>/g)).toHaveLength(1 + 24);
});

test("leaves any other /repo address to the site", async () => {
  expect(await repoPages(new URL("https://stard.example/repos"), deps())).toBeNull();
});
