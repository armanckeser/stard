// GitHub Pages has no SPA fallback: a deep link like /compose gets 404.html (the app)
// with a 404 status, which link checkers and search engines read as a dead page.
// Pages answers /compose with compose.html and a 200, so each fixed route in
// src/routes gets a copy of the app page under its own name. Routes with a
// parameter (list.$listId) can't be listed ahead of time and keep the 404 fallback.
//
//   node scripts/app-pages.mjs dist
import { copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** The pages a route file list needs: compose.tsx → compose.html; root, index and $params need none. */
export function appPages(routeFiles) {
  return routeFiles
    .filter((file) => file.endsWith(".tsx") && !file.startsWith("__") && !file.includes("$"))
    .map((file) => file.replace(/\.tsx$/, ""))
    .filter((name) => name !== "index")
    .map((name) => `${name}.html`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? "dist";
  const routes = fileURLToPath(new URL("../src/routes", import.meta.url));
  for (const page of appPages(readdirSync(routes))) {
    copyFileSync(join(dist, "index.html"), join(dist, page));
    console.log(`${dist}/${page}`);
  }
}
