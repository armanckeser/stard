import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PAGE_HEADS, appPages, pageHtml } from "./app-pages.mjs";

// Issue #176: /compose answered 404 on the public demo though the app rendered.
describe("appPages", () => {
  it("gives every fixed route its own page, so Pages answers it with a 200", () => {
    const pages = appPages(readdirSync(new URL("../src/routes", import.meta.url)));
    expect(pages).toEqual(expect.arrayContaining(["compose.html", "explore.html", "game.html", "backups.html"]));
  });

  it("skips the root layout, the home page and routes with a parameter", () => {
    expect(appPages(["__root.tsx", "index.tsx", "list.$listId.tsx", "run.tsx"])).toEqual(["run.html"]);
  });
});

// /run and /compose pointed their canonical link at "/", so search engines folded them into the front page.
describe("pageHtml", () => {
  const front = `<title>Stard</title><meta name="description" content="Front." /><meta property="og:title" content="Stard" />` +
    `<link rel="canonical" href="https://stard.armanckeser.com/"><meta property="og:url" content="https://stard.armanckeser.com/">`;

  it("points each page's canonical link and og:url at the page itself", () => {
    const page = pageHtml(front, "compose.html");
    expect(page).toContain('<link rel="canonical" href="https://stard.armanckeser.com/compose">');
    expect(page).toContain('<meta property="og:url" content="https://stard.armanckeser.com/compose">');
  });

  it("gives the organizer page its own title and description", () => {
    const page = pageHtml(front, "organize.html");
    expect(page).toContain("<title>Organize your GitHub stars into Lists · Stard</title>");
    expect(page).toContain(`<meta name="description" content="${PAGE_HEADS["organize.html"].description}"`);
    expect(page).toContain('<meta property="og:title" content="Organize your GitHub stars into Lists · Stard"');
  });

  it("keeps the front page's title on pages nobody searches for", () => {
    expect(pageHtml(front, "backups.html")).toContain("<title>Stard</title>");
  });
});
