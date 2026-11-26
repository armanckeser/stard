import { WRAPPED_FONTS, escapeXml, wrappedCard, wrappedNoteCard } from "../../server/cards.ts";
import { SITE_ORIGIN } from "../../server/site.ts";
import { WRAPPED_YEAR, alivePercent, countText, reachedBefore, summaryLine, wrappedStats, type StarEdge, type WrappedStats } from "../../server/wrapped.ts";
import { gql } from "./battle.ts";
import { LOGIN, avatarData, svg } from "./cards.ts";
import { DAY, HOUR, cacheKeyFor, readThrough, type CacheDeps } from "./edge-cache.ts";
import { busyUntil } from "./github-budget.ts";
import { image, png } from "./share.ts";

// "Your 2026 in stars": someone's year of public GitHub stars as a card and a page to
// share it from. Public stars only, read with the Worker's token; no sign-in.
//
//   /wrapped                               a box to type a username in
//   /wrapped/<login>                       the page: the card, share buttons, a README snippet
//   /api/card/wrapped.svg?user=<login>     the card, for a README
//   /api/card/wrapped.png?user=<login>     the card, for link previews (they don't take SVG)
//
// A year's stars are read once a day per data center, newest first, a page of 100 at a
// time until a page reaches back past January 1, and never more than MAX_PAGES pages.

export const WRAPPED_PAGE_PATH = /^\/wrapped(?:\/([^/]*))?\/?$/;
export const WRAPPED_CARD_PATH = /^\/api\/card\/wrapped\.(svg|png)$/;

/** At most this many pages of 100 stars are read; a year with more is shown as "1,000+". */
export const MAX_PAGES = 10;
const STATS_LIFETIME = { fresh: DAY, keep: 7 * DAY };
// A drawn card is kept a shorter while than the stats it is drawn from, so it catches up within the hour.
const CARD_LIFETIME = { fresh: HOUR, keep: DAY };
const PNG_FONT = "Space Grotesk";
const REPO_URL = "https://github.com/armanckeser/stard";

/** `blocked` is the block list of accounts that asked not to have their stars read (worker/src/no-play.ts). */
export type WrappedDeps = CacheDeps & { token: string; blocked?: ReadonlySet<string> };

type StarsPage = {
  user: {
    login: string;
    avatarUrl: string;
    starredRepositories: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: (StarEdge & { node: StarEdge["node"] & { isPrivate: boolean } })[];
    };
  } | null;
};

/** One page of someone's stars, newest first. The login was checked against LOGIN, so the query keeps its shape. */
const starsQuery = (login: string, after: string | null) => `query { user(login: ${JSON.stringify(login)}) {
  login avatarUrl(size: 160)
  starredRepositories(first: 100, ${after ? `after: ${JSON.stringify(after)}, ` : ""}orderBy: { field: STARRED_AT, direction: DESC }) {
    pageInfo { hasNextPage endCursor }
    edges { starredAt node { nameWithOwner isPrivate stargazerCount createdAt pushedAt isArchived primaryLanguage { name color } } }
  }
} }`;

/** Someone's stars back to the start of `year`, or null when there is no such user. */
export async function readYear(token: string, login: string, year = WRAPPED_YEAR): Promise<{ login: string; avatarUrl: string; edges: StarEdge[]; capped: boolean } | null> {
  const edges: StarEdge[] = [];
  let after: string | null = null;
  for (let page = 0; ; page++) {
    const data: StarsPage = await gql<StarsPage>(token, starsQuery(login, after));
    const user = data.user;
    if (!user) return null;
    const read: NonNullable<StarsPage["user"]>["starredRepositories"] = user.starredRepositories;
    edges.push(...read.edges.filter((edge) => !edge.node.isPrivate));
    const done = !read.pageInfo.hasNextPage || reachedBefore(read.edges, year);
    if (done || page === MAX_PAGES - 1) return { login: user.login, avatarUrl: user.avatarUrl, edges, capped: !done };
    after = read.pageInfo.endCursor;
  }
}

/** What a Wrapped read came to: the year, no such user, GitHub busy until a time, or GitHub not answering. */
type Outcome =
  | { kind: "ok"; login: string; avatar: string | null; stats: WrappedStats }
  | { kind: "missing" }
  | { kind: "refused" }
  | { kind: "busy"; until: number }
  | { kind: "failed" };

const noStore = (body: unknown, status: number) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Someone's year, read through the edge cache: GitHub is asked at most once a day per data center. */
async function wrappedOf(login: string, origin: string, deps: WrappedDeps): Promise<Outcome> {
  // Before the cache, so nothing read before the account asked is served after.
  if (deps.blocked?.has(login.toLowerCase())) return { kind: "refused" };
  const key = cacheKeyFor(new URL(`/api/wrapped/stats?user=${login}`, origin), true);
  const reply = await readThrough(
    key,
    async () => {
      // A year not read yet waits while the token's points are low, so the cards in READMEs keep working.
      const busy = busyUntil(deps.now);
      if (busy !== null) return noStore({ busyUntil: busy }, 503);
      try {
        const read = await readYear(deps.token, login);
        if (!read) return Response.json({ missing: true }, { status: 404 });
        const avatar = await avatarData(read.avatarUrl);
        return Response.json({ login: read.login, avatar, stats: wrappedStats(read.edges, deps.now, read.capped) });
      } catch (error) {
        console.error(error);
        return noStore({ failed: true }, 502);
      }
    },
    STATS_LIFETIME,
    deps,
  );
  if (reply.status === 404) return { kind: "missing" };
  if (reply.status === 503) return { kind: "busy", until: ((await reply.json()) as { busyUntil: number }).busyUntil };
  if (!reply.ok) return { kind: "failed" };
  return { kind: "ok", ...((await reply.json()) as { login: string; avatar: string | null; stats: WrappedStats }) };
}

const REFUSED = "This account asked Stard not to read its stars.";

const minutesUntil = (until: number, now: number) => Math.max(1, Math.ceil((until - now) / 60_000));
const soFar = (now: number) => now < Date.UTC(WRAPPED_YEAR + 1, 0, 1);

function busyNote(until: number, now: number): string {
  const minutes = minutesUntil(until, now);
  return `GitHub is busy. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
}

async function picture(kind: string, drawing: string, status: number): Promise<Response> {
  const cacheSeconds = status >= 500 ? 0 : 3600;
  return kind === "svg" ? svg(drawing, status, cacheSeconds) : image(await png(drawing), status, cacheSeconds);
}

/** The card, as SVG for a README or PNG for a link preview. */
export async function wrappedCardResponse(kind: string, url: URL, deps: WrappedDeps): Promise<Response> {
  const font = kind === "svg" ? WRAPPED_FONTS : PNG_FONT;
  const login = url.searchParams.get("user") ?? "";
  if (!LOGIN.test(login)) return picture(kind, wrappedNoteCard("stard", "This card needs a GitHub username, as ?user=<login>.", soFar(deps.now), font), 400);
  if (deps.blocked?.has(login.toLowerCase())) return picture(kind, wrappedNoteCard(login, REFUSED, soFar(deps.now), font), 403);
  return readThrough(
    cacheKeyFor(new URL(`${url.pathname}?user=${login}`, url.origin), true),
    async () => {
      const year = await wrappedOf(login, url.origin, deps);
      if (year.kind === "ok") return picture(kind, wrappedCard(year.login, year.avatar, year.stats, font), 200);
      if (year.kind === "missing") return picture(kind, wrappedNoteCard(login, `No GitHub user called ${login}.`, soFar(deps.now), font), 404);
      const note = year.kind === "refused" ? REFUSED : year.kind === "busy" ? busyNote(year.until, deps.now) : "GitHub didn't answer. This card will be back shortly.";
      return picture(kind, wrappedNoteCard(login, note, soFar(deps.now), font), year.kind === "busy" ? 503 : 502);
    },
    CARD_LIFETIME,
    deps,
  );
}

const STYLE = `
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:#0f1114;color:#f2f0eb;font:16px/1.5 "Space Grotesk",system-ui,sans-serif}
a{color:#f5c84b}
main{max-width:880px;margin:0 auto;padding:24px 16px 48px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:20px}
header a{color:#f2f0eb;text-decoration:none;font-weight:700}
h1{font-size:clamp(26px,5vw,40px);line-height:1.15;letter-spacing:-0.8px;margin:0 0 8px;overflow-wrap:anywhere}
h2{font-size:18px;margin:32px 0 8px}
.lead{font-size:19px;margin:0 0 20px;color:#c5cad0}
.muted{color:#8b949e}
.card{display:block;width:100%;height:auto;border-radius:12px;border:1px solid #262b31}
.next{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0 8px}
.button{display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:8px;font-weight:700;text-decoration:none;border:1px solid #262b31;color:#f2f0eb;background:#161a1f}
.button.primary{background:#2f9e7a;border-color:#2f9e7a;color:#fff;font-size:18px}
.button.star{background:#f5c84b;border-color:#f5c84b;color:#14171a}
.share{display:flex;flex-wrap:wrap;gap:8px}
.copy{display:flex;gap:8px}
.copy input{flex:1;min-width:0;padding:10px 12px;border-radius:8px;border:1px solid #262b31;background:#161a1f;color:#f2f0eb;font:14px ui-monospace,SFMono-Regular,Menlo,monospace}
form{display:flex;gap:8px;flex-wrap:wrap}
form input{flex:1;min-width:180px;padding:12px;border-radius:8px;border:1px solid #262b31;background:#161a1f;color:#f2f0eb;font:inherit}
button{cursor:pointer;font:inherit}
.copy button,form button{padding:10px 16px;border-radius:8px;border:1px solid #262b31;background:#161a1f;color:#f2f0eb;font-weight:700}
footer{margin-top:40px;color:#8b949e;font-size:14px}
`;

// Copies the README snippet; the page works without it, the box can be selected by hand.
const COPY_SCRIPT = `document.querySelectorAll("[data-copy]").forEach(function(b){b.addEventListener("click",function(){var i=document.getElementById(b.dataset.copy);i.select();navigator.clipboard&&navigator.clipboard.writeText(i.value);b.textContent="Copied";});});`;

type Meta = { title: string; description: string; path: string; image: string; alt: string };

function page(meta: Meta, body: string): string {
  const tags = [
    ["property", "og:type", "website"],
    ["property", "og:url", `${SITE_ORIGIN}${meta.path}`],
    ["property", "og:title", meta.title],
    ["property", "og:description", meta.description],
    ["property", "og:image", meta.image],
    ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"],
    ["property", "og:image:alt", meta.alt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.title],
    ["name", "twitter:description", meta.description],
    ["name", "twitter:image", meta.image],
  ].map(([kind, key, value]) => `<meta ${kind}="${key}" content="${escapeXml(value)}">`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(meta.title)}</title><meta name="description" content="${escapeXml(meta.description)}"><link rel="canonical" href="${SITE_ORIGIN}${escapeXml(meta.path)}">${tags}
<link rel="icon" href="/favicon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;700&display=swap">
<style>${STYLE}</style></head><body><main><header><a href="/">★ stard</a><a class="button star" href="${REPO_URL}">★ Star stard on GitHub</a></header>${body}
<footer>Public stars only, read from GitHub once a day. Months are counted in UTC. Stard is free and open source: <a href="${REPO_URL}">${REPO_URL.replace("https://", "")}</a></footer>
</main><script>${COPY_SCRIPT}</script></body></html>`;
}

function html(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": status >= 500 ? "no-store" : "public, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}

const makeYours = (value = "") =>
  `<h2>Make yours</h2><form action="/wrapped" method="get"><input name="user" value="${escapeXml(value)}" placeholder="GitHub username" aria-label="GitHub username" autocapitalize="off" autocomplete="off" spellcheck="false" required><button type="submit">See my year</button></form>`;

const intro = `Every Wrapped sums up commits. This one sums up what you starred: how many repos, your top languages, the month you starred most, the earliest find, and how many are still alive.`;

/** The page for a typed username's year, with the card and everything to share it. */
function yearPage(login: string, stats: WrappedStats): string {
  const path = `/wrapped/${login}`;
  const pageUrl = `${SITE_ORIGIN}${path}`;
  const svgUrl = `${SITE_ORIGIN}/api/card/wrapped.svg?user=${login}`;
  const line = summaryLine(stats);
  const post = `My ${stats.year} in GitHub stars: ${line} Yours: ${pageUrl.replace("https://", "")}`;
  const snippet = `[![${stats.year} in stars](${svgUrl})](${pageUrl})`;
  const shown = countText(stats);
  const alive = alivePercent(stats);
  // The organizer reads someone's latest 500 stars, so a bigger year is "your stars".
  const sortText = stats.count > 0 && stats.count <= 500 && !stats.capped ? `Now sort these ${shown} stars into Lists →` : "Now sort your stars into Lists →";
  const facts = [
    stats.earlyFind ? `Earliest find: ${stats.earlyFind.fullName}, starred at ${stats.earlyFind.daysOld} ${stats.earlyFind.daysOld === 1 ? "day" : "days"} old.` : "",
    alive !== null ? `${alive}% are still alive, pushed to in the last 90 days.` : "",
  ].filter(Boolean).join(" ");
  const body =
    `<h1>${escapeXml(login)}'s ${stats.year} in GitHub stars${stats.soFar ? " so far" : ""}</h1>` +
    `<p class="lead">${escapeXml(`${line} ${facts}`.trim())}</p>` +
    `<img class="card" src="/api/card/wrapped.svg?user=${escapeXml(login)}" width="1200" height="630" alt="${escapeXml(`${login}'s ${stats.year} in GitHub stars: ${line}`)}">` +
    `<div class="next"><a class="button primary" href="/organize?user=${escapeXml(login)}">${escapeXml(sortText)}</a><a class="button" href="/run?me=${escapeXml(login)}">Or play a card battle with them</a></div>` +
    `<p class="muted">Stard sorts your stars into GitHub Lists and flags the dead ones. No sign-in to look; a token to write Lists.</p>` +
    `<h2>Share it</h2><div class="share">` +
    `<a class="button" href="https://x.com/intent/tweet?text=${encodeURIComponent(post)}">Post on X</a>` +
    `<a class="button" href="https://bsky.app/intent/compose?text=${encodeURIComponent(post)}">Post on Bluesky</a></div>` +
    `<h2>Put it in your README</h2><div class="copy"><input id="snippet" readonly value="${escapeXml(snippet)}" aria-label="README snippet"><button type="button" data-copy="snippet">Copy</button></div>` +
    makeYours();
  return page(
    {
      title: `${login}'s ${stats.year} in GitHub stars · Stard`,
      description: `${line} ${intro}`,
      path,
      image: `${SITE_ORIGIN}/api/card/wrapped.png?user=${login}`,
      alt: `${login}'s ${stats.year} in GitHub stars: ${shown} repos, stars by month, top languages, earliest find and how many are still alive`,
    },
    body,
  );
}

const landingMeta = (path: string): Meta => ({
  title: `Your ${WRAPPED_YEAR} in GitHub stars · Stard`,
  description: intro,
  path,
  image: `${SITE_ORIGIN}/og.jpg`,
  alt: "Stard",
});

/** A page with a message in place of a year: no such user, or GitHub busy. */
function notePage(heading: string, text: string, typed: string): string {
  return page(landingMeta("/wrapped"), `<h1>${escapeXml(heading)}</h1><p class="lead">${escapeXml(text)}</p>${makeYours(typed)}`);
}

/** The answer for a GET under /wrapped, or null when the path isn't one of these pages. */
export async function wrappedPage(url: URL, deps: WrappedDeps): Promise<Response | null> {
  const match = WRAPPED_PAGE_PATH.exec(url.pathname);
  if (!match) return null;
  const typed = (match[1] ?? "").trim();
  if (!typed) {
    // The "Make yours" box sends ?user=; a typed "@name" works too.
    const asked = (url.searchParams.get("user") ?? "").trim().replace(/^@/, "");
    if (LOGIN.test(asked)) return Response.redirect(`${url.origin}/wrapped/${asked}`, 302);
    const body = `<h1>Your ${WRAPPED_YEAR} in GitHub stars</h1><p class="lead">${escapeXml(intro)} Public stars only, no sign-in.</p>${makeYours(asked)}`;
    return html(page(landingMeta("/wrapped"), body), 200);
  }
  const login = typed.replace(/^@/, "");
  if (!LOGIN.test(login)) return html(notePage("That isn't a GitHub username", `GitHub usernames are letters, digits and single hyphens.`, ""), 404);
  const year = await wrappedOf(login, url.origin, deps);
  if (year.kind === "missing") return html(notePage(`No GitHub user called ${login}`, "Check the spelling and try again.", login), 404);
  if (year.kind === "refused") return html(notePage(`${login}'s year isn't shown`, REFUSED, ""), 403);
  if (year.kind === "busy") return html(notePage("GitHub is busy", busyNote(year.until, deps.now), login), 503);
  if (year.kind === "failed") return html(notePage("GitHub didn't answer", "Try again in a minute.", login), 502);
  // One address per person: GitHub's spelling of the login.
  if (year.login !== login) return Response.redirect(`${url.origin}/wrapped/${year.login}`, 301);
  return html(yearPage(year.login, year.stats), 200);
}
