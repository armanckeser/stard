// GitHub Pages has no SPA fallback: a deep link like /compose gets 404.html (the app)
// with a 404 status, which link checkers and search engines read as a dead page.
// Pages answers /compose with compose.html and a 200, so each fixed route in
// src/routes gets a copy of the app page under its own name. Routes with a
// parameter (list.$listId) can't be listed ahead of time and keep the 404 fallback.
// Each copy points its canonical link at its own address, so search engines index
// /run and /compose as pages of their own, and the pages people search for get
// their own title and description.
//
//   node scripts/app-pages.mjs dist
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
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

/** Titles and descriptions for the pages people search for; the rest keep the front page's. */
export const PAGE_HEADS = {
  "organize.html": {
    title: "Organize your GitHub stars into Lists · Stard",
    description: "Sort your GitHub stars into Lists with tags, notes and 1 to 5 ratings, and see which starred repos are dead. Free and open source: run with npx or self-host with Docker.",
  },
  "run.html": {
    title: "Play a card battle with your GitHub stars · Stard",
    description: "Every repo you starred becomes a card. Build a team and fight other teams: 5 wins finishes a run, 3 losses ends one. Type any GitHub username, no sign-in.",
  },
  "compose.html": {
    title: "Profile cards from your GitHub stars · Stard",
    description: "Put your top four repos, short reviews and your GitHub Lists on your profile README as cards. Type a GitHub username, no sign-in.",
  },
  "explore.html": {
    title: "Charts of your GitHub stars · Stard",
    description: "Your GitHub stars by language, health and last commit, and what you starred over the years.",
  },
};

const attribute = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** The front page's HTML made into the page at /<name>: a canonical link to that address, and its own title and description. */
export function pageHtml(html, page) {
  const path = page.replace(/\.html$/, "");
  let out = html.replace(/(rel="canonical" href="[^"]*?)\/?"/, `$1/${path}"`).replace(/(property="og:url" content="[^"]*?)\/?"/, `$1/${path}"`);
  const head = PAGE_HEADS[page];
  if (!head) return out;
  const title = attribute(head.title);
  const description = attribute(head.description);
  out = out.replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`);
  for (const key of ['name="description"', 'property="og:description"', 'name="twitter:description"']) {
    out = out.replace(new RegExp(`(<meta ${key} content=")[^"]*"`), `$1${description}"`);
  }
  for (const key of ['property="og:title"', 'name="twitter:title"']) {
    out = out.replace(new RegExp(`(<meta ${key} content=")[^"]*"`), `$1${title}"`);
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dist = process.argv[2] ?? "dist";
  const routes = fileURLToPath(new URL("../src/routes", import.meta.url));
  const html = readFileSync(join(dist, "index.html"), "utf8");
  for (const page of appPages(readdirSync(routes))) {
    writeFileSync(join(dist, page), pageHtml(html, page));
    console.log(`${dist}/${page}`);
  }
}
