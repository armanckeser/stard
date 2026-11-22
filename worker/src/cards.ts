import { listCard, matchupCard, messageCard, pulseOf, reviewCard, topFourCard, type CardRepo } from "../../server/cards.ts";
import { askGitHub } from "./github-budget.ts";

// The SVGs a profile README embeds (server/cards.ts draws them):
//
//   /api/card/top4.svg?user=<login>&repos=<owner/name,...>&ratings=<5,4.5,...>
//   /api/card/review.svg?user=<login>&repo=<owner/name>&rating=<4.5>&text=<what they wrote>
//   /api/card/list.svg?user=<login>&title=<name>&count=<n>&repos=<owner/name,...>
//   /api/card/matchup.svg?a=<owner/name>&b=<owner/name>&title=<what they both do>
//
// Everything a card shows is in its address, so nothing is stored here. GitHub
// fetches each card through its image proxy and keeps its own copy for a while.

export const CARD_PATH = /^\/api\/card\/(top4|review|list)\.svg$/;

export const LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
export const REPO = /^[\w.-]{1,39}\/[\w.-]{1,100}$/;
const CACHE_SECONDS = 6 * 3600;
const MAX_REPOS = 6;
const MAX_REVIEW_CHARS = 400;

type RepoNode = {
  nameWithOwner: string;
  stargazerCount: number;
  primaryLanguage: { name: string; color: string | null } | null;
  owner: { avatarUrl: string };
  createdAt?: string;
  isArchived?: boolean;
  defaultBranchRef?: { target?: Record<string, { totalCount: number } | undefined> } | null;
  merged?: { nodes: { mergedAt: string | null }[] };
  closed?: { nodes: { closedAt: string | null }[] };
  shipped?: { nodes: { publishedAt: string | null }[] };
  forkCount?: number;
  licenseInfo?: { spdxId: string | null } | null;
  openIssues?: { totalCount: number };
  closedIssues?: { totalCount: number };
  latestRelease?: { publishedAt: string | null } | null;
};

// What a matchup compares, asked for only when drawing one.
const TAPE_FIELDS =
  " forkCount licenseInfo { spdxId } openIssues: issues(states: OPEN) { totalCount } closedIssues: issues(states: CLOSED) { totalCount } latestRelease { publishedAt }";

// The pulse covers a year in 30-day windows that end now, so the last one is never
// a half-finished calendar month.
const WINDOWS = 12;
const WINDOW_MS = 30 * 86_400_000;

function pulseFields(now: number): string {
  const history = Array.from({ length: WINDOWS }, (_, i) => {
    const since = new Date(now - (WINDOWS - i) * WINDOW_MS).toISOString();
    const until = new Date(now - (WINDOWS - 1 - i) * WINDOW_MS).toISOString();
    return `c${i}: history(since: "${since}", until: "${until}") { totalCount }`;
  });
  // The latest 100 merged PRs and closed issues: a repo busy enough to have more in a
  // year is full colour from its commits alone.
  return (
    ` createdAt isArchived defaultBranchRef { target { ... on Commit { ${history.join(" ")} } } }` +
    " merged: pullRequests(states: MERGED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { mergedAt } }" +
    " closed: issues(states: CLOSED, first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { closedAt } }" +
    " shipped: releases(first: 20, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { publishedAt } }"
  );
}

/** The repo's pulse, or null when GitHub left out its commit history (an empty repo). */
export function pulseFromNode(node: RepoNode, now: number): number[] | null {
  const target = node.defaultBranchRef?.target;
  if (!target?.c0 || !node.createdAt) return null;
  const activity = Array.from({ length: WINDOWS }, (_, i) => target[`c${i}`]?.totalCount ?? 0);
  const add = (at: string | null, weight: number) => {
    const i = WINDOWS - 1 - Math.floor((now - Date.parse(at ?? "")) / WINDOW_MS);
    if (i >= 0 && i < WINDOWS) activity[i] += weight;
  };
  node.merged?.nodes.forEach((n) => add(n.mergedAt, 2));
  node.closed?.nodes.forEach((n) => add(n.closedAt, 2));
  node.shipped?.nodes.forEach((n) => add(n.publishedAt, 5));
  const monthsAlive = Math.ceil((now - Date.parse(node.createdAt)) / WINDOW_MS);
  return pulseOf(activity, monthsAlive, node.isArchived ?? false);
}

// btoa wants a binary string; building one in chunks keeps a large avatar off the call stack.
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

// An SVG shown through <img> can't load outside images, so each avatar goes in as data.
export async function avatarData(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const type = response.headers.get("Content-Type") ?? "image/png";
    return `data:${type};base64,${base64(new Uint8Array(await response.arrayBuffer()))}`;
  } catch {
    return null;
  }
}

// One fixed-shape query for the named repos. The names were checked against REPO, so
// this never becomes a general GraphQL proxy on the owner's token. A repo that is
// gone or private comes back null and is left off the card.
async function fetchRepos(token: string, names: string[], withTape = false): Promise<CardRepo[]> {
  const now = Date.now();
  const fields = `nameWithOwner stargazerCount primaryLanguage { name color } owner { avatarUrl(size: 96) }${pulseFields(now)}${withTape ? TAPE_FIELDS : ""}`;
  const query = `query {${names
    .map((name, i) => {
      const [owner, repo] = name.split("/");
      return ` r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${fields} }`;
    })
    .join("")} }`;
  const response = await askGitHub(token, { query });
  const json = (await response.json().catch(() => ({}))) as { data?: Record<string, RepoNode | null> };
  if (!json.data) throw new Error(`GitHub returned ${response.status}`);
  const nodes = names.flatMap((_, i) => json.data![`r${i}`] ?? []);
  return Promise.all(
    nodes.map(async (node) => ({
      fullName: node.nameWithOwner,
      stars: node.stargazerCount,
      language: node.primaryLanguage?.name ?? null,
      color: node.primaryLanguage?.color ?? null,
      avatar: await avatarData(node.owner.avatarUrl),
      pulse: pulseFromNode(node, now),
      ...(withTape && {
        tape: {
          forks: node.forkCount ?? 0,
          // GitHub calls an unrecognised licence NOASSERTION; the card says "other".
          license: node.licenseInfo?.spdxId === "NOASSERTION" ? "other" : (node.licenseInfo?.spdxId ?? null),
          openIssues: node.openIssues?.totalCount ?? 0,
          closedIssues: node.closedIssues?.totalCount ?? 0,
          lastRelease: node.latestRelease?.publishedAt ?? null,
        },
      }),
    })),
  );
}

export function svg(body: string, status: number, cacheSeconds: number): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cacheSeconds > 0 ? `public, max-age=${cacheSeconds}` : "no-store",
      // A card holds text people typed. Opened directly it is a document on this
      // domain, so it may run nothing and load nothing but its own inline images.
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
      // The app previews cards from other origins (a self-hosted copy, the npx version).
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function parseRating(value: string | null | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 && n <= 5 ? Math.round(n * 2) / 2 : null;
}

export async function cardResponse(kind: string, params: URLSearchParams, token: string): Promise<Response> {
  if (kind === "matchup") return matchupResponse(params, token);
  const login = params.get("user") ?? "";
  if (!LOGIN.test(login)) return svg(messageCard("This card needs a GitHub username."), 400, CACHE_SECONDS);
  const names = (params.get("repos") ?? params.get("repo") ?? "")
    .split(",")
    .filter((name) => REPO.test(name))
    .slice(0, MAX_REPOS);
  if (names.length === 0) return svg(messageCard("This card has no repos to show."), 400, CACHE_SECONDS);
  try {
    const repos = await fetchRepos(token, names);
    if (repos.length === 0) return svg(messageCard("None of this card's repos could be found on GitHub."), 404, CACHE_SECONDS);
    if (kind === "top4") {
      // Ratings line up with the repos asked for, so a missing repo takes its rating with it.
      const asked = (params.get("ratings") ?? "").split(",");
      const found = new Map(repos.map((r) => [r.fullName.toLowerCase(), r]));
      const kept = names.slice(0, 4).flatMap((name, i) => {
        const repo = found.get(name.toLowerCase());
        return repo ? [{ repo, rating: parseRating(asked[i]) }] : [];
      });
      return svg(topFourCard(login, kept.map((k) => k.repo), kept.map((k) => k.rating)), 200, CACHE_SECONDS);
    }
    if (kind === "review") {
      const text = (params.get("text") ?? "").slice(0, MAX_REVIEW_CHARS);
      return svg(reviewCard(login, repos[0], parseRating(params.get("rating")), text), 200, CACHE_SECONDS);
    }
    const count = Math.max(Number.parseInt(params.get("count") ?? "", 10) || 0, repos.length);
    return svg(listCard(login, (params.get("title") ?? "").slice(0, 80) || "A list", count, repos), 200, CACHE_SECONDS);
  } catch (error) {
    console.error(error);
    return svg(messageCard("GitHub didn't answer. This card will be back shortly."), 502, 0);
  }
}

// A matchup names two repos and what they both do; it is nobody's card, so it takes no user.
async function matchupResponse(params: URLSearchParams, token: string): Promise<Response> {
  const names = [params.get("a") ?? "", params.get("b") ?? ""];
  if (!names.every((name) => REPO.test(name)) || names[0].toLowerCase() === names[1].toLowerCase()) {
    return svg(messageCard("A matchup needs two different repos, as a=owner/name and b=owner/name."), 400, CACHE_SECONDS);
  }
  try {
    const repos = await fetchRepos(token, names, true);
    if (repos.length < 2) return svg(messageCard("One of this matchup's repos could not be found on GitHub."), 404, CACHE_SECONDS);
    return svg(matchupCard((params.get("title") ?? "").slice(0, 60) || "Head to head", repos[0], repos[1], Date.now()), 200, CACHE_SECONDS);
  } catch (error) {
    console.error(error);
    return svg(messageCard("GitHub didn't answer. This card will be back shortly."), 502, 0);
  }
}
