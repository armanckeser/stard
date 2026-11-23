import { fighterFor } from "../../server/battle.ts";
import { cardPicture, escapeXml } from "../../server/cards.ts";
import { creatureRecipe } from "../../server/creature-recipe.ts";
import { ABILITIES } from "../../server/run/abilities.ts";
import { priceOf, type RunFighter } from "../../server/run/rules.ts";
import { cardFor, type CardFacts } from "../../server/run/stats.ts";
import { SITE_ORIGIN } from "../../server/site.ts";
import { factsFor, gql, readFacts, toFacts, type FactsStore } from "./battle.ts";
import { DAY, cacheKeyFor, readThrough, type CacheDeps } from "./edge-cache.ts";
import { setsOf } from "../../server/run/sets.ts";

// A page for each public repo, for people who search a repo's stars: the numbers
// GitHub has, and the card the repo is in Stard, with a way into a run. The site is
// one static app, which search engines read poorly, so these are written here as HTML.
//
//   /repo                    the most-starred repos, each linked to its page
//   /repo/<owner>/<name>     one repo's page
//   /repo/sitemap.xml        the list's pages, for search engines

export const REPO_PAGE_PATH = /^\/repo(?:\/([\w.-]{1,39})\/([\w.-]{1,100}))?\/?$/;
export const REPO_SITEMAP_PATH = /^\/repo\/sitemap\.xml$/;

/** How many of the most-starred repos the list and the sitemap name. */
export const TOP_COUNT = 100;
const TOP_QUERY = "stars:>=50000 sort:stars-desc";
const PAGE_LIFETIME = { fresh: DAY, keep: 7 * DAY };
const NEIGHBOURS = 12;
const FONT = "Space Grotesk";

export type RepoPageDeps = CacheDeps & { token: string; facts?: FactsStore };

type TopRepo = { name: string; stars: number | null };

/** The most-starred repos, one GitHub search a day shared through the edge cache. */
async function topRepos(origin: string, deps: RepoPageDeps): Promise<TopRepo[]> {
  const day = new Date(deps.now).toISOString().slice(0, 10);
  const key = new Request(new URL(`/api/repo/top?day=${day}&n=${TOP_COUNT}`, origin));
  const reply = await readThrough(
    key,
    async () => {
      try {
        const found = await gql<{ b0: { nodes: ({ nameWithOwner?: string; stargazerCount?: number } | null)[] } | null }>(
          deps.token,
          `query { b0: search(query: ${JSON.stringify(TOP_QUERY)}, type: REPOSITORY, first: ${TOP_COUNT}) { nodes { ... on Repository { nameWithOwner stargazerCount } } } }`,
        );
        const repos = (found.b0?.nodes ?? []).flatMap((node) => (node?.nameWithOwner ? [{ name: node.nameWithOwner, stars: node.stargazerCount ?? null }] : []));
        return Response.json(repos);
      } catch (error) {
        console.error(error);
        return new Response("[]", { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    },
    { fresh: DAY, keep: 2 * DAY },
    deps,
  );
  return reply.ok ? ((await reply.json()) as TopRepo[]) : [];
}

const count = (n: number) => n.toLocaleString("en-US");
const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "never");

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0e1418;color:#f2f0eb;font:16px/1.5 "${FONT}",system-ui,sans-serif}
a{color:#f5c84b}
main{max-width:880px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
header a{color:#f2f0eb;text-decoration:none;font-weight:700}
h1{font-size:clamp(28px,6vw,44px);line-height:1.1;letter-spacing:-1px;margin:0 0 8px;overflow-wrap:anywhere}
h2{font-size:20px;margin:32px 0 12px}
.lead{font-size:20px;margin:0 0 4px}
.muted{color:#8b949e}
.repo{display:grid;grid-template-columns:240px 1fr;gap:32px;align-items:start;margin-top:24px}
@media (max-width:600px){.repo{grid-template-columns:1fr}.repo svg{margin:0 auto;display:block}}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0}
dt{color:#8b949e}
dd{margin:0;font-weight:700}
.play{display:inline-block;margin-top:20px;padding:12px 20px;background:#2f9e7a;color:#fff;border-radius:6px;font-weight:700;text-decoration:none}
ol,ul{padding-left:20px}
li{margin:4px 0}
.grid{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:4px 16px}
`;

function page(title: string, description: string, path: string, body: string, index = true): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(title)}</title><meta name="description" content="${escapeXml(description)}">
${index ? `<link rel="canonical" href="${SITE_ORIGIN}${escapeXml(path)}">` : `<meta name="robots" content="noindex">`}
<meta property="og:type" content="website"><meta property="og:title" content="${escapeXml(title)}"><meta property="og:description" content="${escapeXml(description)}"><meta property="og:image" content="${SITE_ORIGIN}/og.jpg">
<link rel="icon" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap">
<style>${STYLE}</style></head><body><main><header><a href="/">★ stard</a><a href="/repo">Most-starred repos</a></header>${body}</main></body></html>`;
}

// A page drawn without GitHub's answer (a 502) is never kept.
function html(body: string, status: number): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": status === 502 ? "no-store" : "public, max-age=3600" } });
}

function topList(repos: TopRepo[], className = ""): string {
  const items = repos.map((repo) => `<li><a href="/repo/${escapeXml(repo.name)}">${escapeXml(repo.name)}</a>${repo.stars === null ? "" : ` <span class="muted">★ ${count(repo.stars)}</span>`}</li>`);
  return className ? `<ul class="${className}">${items.join("")}</ul>` : `<ol>${items.join("")}</ol>`;
}

async function indexPage(origin: string, deps: RepoPageDeps): Promise<Response> {
  const repos = await topRepos(origin, deps);
  const body =
    `<h1>The most-starred repos on GitHub</h1><p class="lead">The ${repos.length} public repos with the most stars, as GitHub counts them today. Open one to see its numbers and the card it is in Stard.</p>` +
    topList(repos);
  return html(page("The most-starred GitHub repos · Stard", `The ${repos.length} most-starred repos on GitHub, with each one's star count and its card in Stard, a card battle built from GitHub stars.`, "/repo", body), repos.length ? 200 : 502);
}

async function repoPage(owner: string, name: string, origin: string, deps: RepoPageDeps): Promise<Response> {
  let [node] = await factsFor(deps.token, [`${owner}/${name}`], deps.now, deps.facts);
  // GitHub answers a moved repo (facebook/react is now react/react) under its new name, which factsFor doesn't match.
  if (!node) [node] = await readFacts(deps.token, [`${owner}/${name}`]);
  if (!node) {
    const body = `<h1>No public repo called ${escapeXml(`${owner}/${name}`)}</h1><p>GitHub has no public repo by that name. <a href="/repo">See the most-starred repos</a>.</p>`;
    return html(page("Repo not found · Stard", "GitHub has no public repo by that name.", "/repo", body, false), 404);
  }
  if (node.nameWithOwner !== `${owner}/${name}`) return Response.redirect(`${origin}/repo/${node.nameWithOwner}`, 301);

  const facts: CardFacts = { ...toFacts(node), topics: node.repositoryTopics.nodes.map((entry) => entry.topic.name) };
  const card = cardFor(facts, deps.now);
  const fighter: RunFighter = { ...fighterFor(facts, "", deps.now), hp: card.hp, attack: card.attack, defense: card.guard, speed: card.speed, shiny: card.shiny, card };
  const picture = { name: node.nameWithOwner.split("/")[1], cost: priceOf(card.rarity), sets: setsOf(card), creature: creatureRecipe(fighter) };
  const ability = ABILITIES.find((entry) => entry.id === card.ability);
  const top = await topRepos(origin, deps);
  const at = top.findIndex((repo) => repo.name.toLowerCase() === node.nameWithOwner.toLowerCase());
  const others = top.filter((_, i) => i !== at).slice(Math.max(0, at - NEIGHBOURS / 2), Math.max(0, at - NEIGHBOURS / 2) + NEIGHBOURS);

  const full = node.nameWithOwner;
  const stars = count(node.stargazerCount);
  const state = node.isArchived ? "Archived" : card.quiet ? "Quiet: no push in six months" : "Active";
  const body =
    `<h1>${escapeXml(full)}</h1>` +
    `<p class="lead">★ ${stars} stars on GitHub${at >= 0 ? `, number ${at + 1} of the most-starred repos` : ""}.</p>` +
    (node.description ? `<p class="muted">${escapeXml(node.description)}</p>` : "") +
    `<div class="repo">${cardPicture(picture, FONT)}<div>` +
    `<dl><dt>Stars</dt><dd>${stars}</dd><dt>Forks</dt><dd>${count(node.forkCount)}</dd><dt>Language</dt><dd>${escapeXml(node.primaryLanguage?.name ?? "None")}</dd>` +
    `<dt>Open issues</dt><dd>${count(node.openIssues.totalCount)}</dd><dt>Last push</dt><dd>${dateOf(node.pushedAt)}</dd><dt>Created</dt><dd>${dateOf(node.createdAt)}</dd><dt>State</dt><dd>${state}</dd></dl>` +
    `<h2>As a Stard card</h2><dl><dt>Cost</dt><dd>${priceOf(card.rarity)} gold</dd><dt>HP</dt><dd>${card.hp}</dd><dt>Attack</dt><dd>${card.attack}</dd><dt>Guard</dt><dd>${card.guard}</dd><dt>Speed</dt><dd>${card.speed}</dd>` +
    `<dt>Range</dt><dd>${card.range === 3 ? "Hits from behind" : "Fights up close"}</dd>` +
    (ability ? `<dt>Ability</dt><dd>${escapeXml(ability.name)}: <span class="muted">${escapeXml(ability.text)}</span></dd>` : "") +
    `</dl><a class="play" href="/run">Play a run with your stars</a>` +
    `<p class="muted">Stard turns every repo you starred into a card like this one. Build a team and fight other developers' teams. No sign-in.</p>` +
    `<p><a href="https://github.com/${escapeXml(full)}">${escapeXml(full)} on GitHub</a></p></div></div>` +
    (others.length ? `<h2>More of the most-starred repos</h2>${topList(others, "grid")}` : "");
  const description = `${full} has ${stars} stars on GitHub${node.description ? `: ${node.description.slice(0, 120)}` : "."} See its forks, last push, and the card it is in Stard.`;
  return html(page(`${full}: ${stars} GitHub stars · Stard`, description, `/repo/${full}`, body), 200);
}

async function sitemap(origin: string, deps: RepoPageDeps): Promise<Response> {
  const repos = await topRepos(origin, deps);
  const urls = ["/repo", ...repos.map((repo) => `/repo/${repo.name}`)].map((path) => `<url><loc>${SITE_ORIGIN}${escapeXml(path)}</loc></url>`);
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`, {
    status: repos.length ? 200 : 502,
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": repos.length ? "public, max-age=3600" : "no-store" },
  });
}

/** The answer for a GET under /repo, or null when the path isn't one of these pages. */
export async function repoPages(url: URL, deps: RepoPageDeps): Promise<Response | null> {
  if (REPO_SITEMAP_PATH.test(url.pathname)) return sitemap(url.origin, deps);
  const match = REPO_PAGE_PATH.exec(url.pathname);
  if (!match) return null;
  const [, owner, name] = match;
  // A repo's numbers change slowly: a page is drawn at most once a day per data center.
  return readThrough(
    cacheKeyFor(new URL(url.pathname, url.origin), false),
    async () => {
      try {
        return owner ? await repoPage(owner, name, url.origin, deps) : await indexPage(url.origin, deps);
      } catch (error) {
        console.error(error);
        return new Response("GitHub didn't answer. Try again shortly.", { status: 502, headers: { "Cache-Control": "no-store" } });
      }
    },
    PAGE_LIFETIME,
    deps,
  );
}
