import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { appPages } from "./app-pages.mjs";

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
