// A GitHub that answers the Worker's GraphQL queries from made-up Greendale accounts,
// so a test can open a match without the network. Every login and repo here is
// invented; nothing is read from a real account.

import { OPPONENTS } from "../../server/run/rules.ts";

type Repo = { language: string | null; stars: number; forks: number; topics: string[]; pushedAt: string };

/** How many popular repos the fake search finds in each star band. */
// Enough that a run's 40-card pool can be filled from popular repos alone (worker/src/battle.ts).
export const POPULAR_PER_BAND = 12;

/**
 * Popular repos for GitHub's search to find, twelve in each star band a rarity starts at
 * (100, 1,000, 10,000 and 100,000 stars), owned by made-up Greendale sponsors.
 */
function popularRepos(): Record<string, Repo> {
  const bands = [
    { owner: "chang-dynasty", stars: 500, language: "Python" },
    { owner: "subway-sandwiches", stars: 5000, language: "Go" },
    { owner: "hawthorne-wipes", stars: 50_000, language: "TypeScript" },
    { owner: "honda-dealership", stars: 200_000, language: "Rust" },
  ];
  return Object.fromEntries(
    bands.flatMap((band) => Array.from({ length: POPULAR_PER_BAND }, (_, i) => [`${band.owner}/sponsor-${i}`, { language: band.language, stars: band.stars + i, forks: 40, topics: [], pushedAt: "2026-10-01T00:00:00Z" }])),
  );
}

const POPULAR_REPOS = popularRepos();
/** Every popular repo the fake search can find. */
export const POPULAR = Object.keys(POPULAR_REPOS);

const REPOS: Record<string, Repo> = {
  "greendale/dreamatorium": { language: "TypeScript", stars: 4200, forks: 310, topics: ["simulation", "game"], pushedAt: "2026-11-01T09:00:00Z" },
  "cougar-town/kickpuncher": { language: "TypeScript", stars: 830, forks: 41, topics: ["cli"], pushedAt: "2026-06-15T00:00:00Z" },
  "inspector-spacetime/constables": { language: "Python", stars: 15000, forks: 2100, topics: ["ai", "data"], pushedAt: "2026-10-30T00:00:00Z" },
  "troy-barnes/blanket-fort": { language: "JavaScript", stars: 260, forks: 12, topics: ["web"], pushedAt: "2025-02-02T00:00:00Z" },
  "greendale/paintball-assassin": { language: "Rust", stars: 9100, forks: 640, topics: ["game", "security"], pushedAt: "2026-11-08T00:00:00Z" },
  "city-college/mascot": { language: "Go", stars: 1900, forks: 88, topics: [], pushedAt: "2026-09-09T00:00:00Z" },
  "greendale/human-being": { language: "HTML", stars: 75, forks: 3, topics: ["web"], pushedAt: "2023-04-01T00:00:00Z" },
  ...POPULAR_REPOS,
};

/** Repos that moved, by their old name: GitHub answers the old name with the repo under its new one. */
export const MOVED: Record<string, string> = { "greendale/old-dreamatorium": "greendale/dreamatorium" };

type Account = { readme: string | null; pinned: string[]; stars: string[]; characterFile?: string; noPlay?: true };

export const HOST = "study-group-abed";
export const GUEST = "study-group-annie";
/** Has a character file kept in this repo, and nothing of their own. */
export const LISTED = "study-group-troy";
/** Has their own `stard/character.md` as well as a file kept in this repo. */
export const OWN_FILE = "study-group-shirley";
/** Has a character file kept in this repo, and a `stard/no-play` file: opted out of being played. */
export const LISTED_LEFT_OUT = "study-group-dean";

// `characters/<login>.md` in this repo.
const LISTED_FILES: Record<string, string> = {
  [LISTED]: "name: Troy\nhair: buzz\nhair-color: black\nbeard: stubble\ntop: tee\ntop-color: blue",
  [OWN_FILE]: "name: Shirley (kept here)\nhair: long",
  [LISTED_LEFT_OUT]: "name: Dean (kept here)\nhair: bald\nglasses: shades",
};
/** No stars, no pinned repos and no repos of their own. */
export const NEWCOMER = "study-group-pierce";
/** Enough stars to fill a run's pool without any popular repos. */
export const COLLECTOR = "study-group-britta";
// A run's opponents are a fixed list of real logins (server/run/rules.ts). This one
// answers with invented Greendale repos; nothing is read from the real account.
export const RIVAL = OPPONENTS[0];

const ACCOUNTS: Record<string, Account> = {
  // A trainer card and a top four in the `stard` README: a specialist, with an ace from the README.
  [HOST]: {
    readme: `Cool. Cool cool cool.\n![](https://cards.example/api/card/trainer.svg?user=${HOST}&name=Abed&class=specialist)\n![](https://cards.example/api/card/top4.svg?repos=greendale/dreamatorium)`,
    pinned: [],
    stars: ["cougar-town/kickpuncher", "inspector-spacetime/constables", "troy-barnes/blanket-fort"],
  },
  // No README: the default character, the ace from a pinned repo, only two stars.
  [GUEST]: { readme: null, pinned: ["greendale/paintball-assassin", "city-college/mascot"], stars: ["city-college/mascot", "greendale/human-being"] },
  [LISTED]: { readme: null, pinned: ["troy-barnes/blanket-fort"], stars: [] },
  [LISTED_LEFT_OUT]: { readme: "# Dean", pinned: ["greendale/human-being"], stars: [], noPlay: true },
  [OWN_FILE]: { readme: "# Shirley", pinned: ["greendale/human-being"], stars: [], characterFile: "name: Shirley\nhair: medium\nglasses: square\nhat: beanie" },
  [NEWCOMER]: { readme: null, pinned: [], stars: [] },
  [COLLECTOR]: { readme: null, pinned: ["greendale/dreamatorium"], stars: [...POPULAR, "city-college/mascot"] },
  [RIVAL]: { readme: null, pinned: ["city-college/mascot"], stars: ["greendale/dreamatorium", "troy-barnes/blanket-fort"] },
};

function repoNode(fullName: string) {
  const repo = REPOS[fullName];
  return {
    nameWithOwner: fullName, description: `${fullName} for the study group`, stargazerCount: repo.stars, forkCount: repo.forks,
    isArchived: false, createdAt: "2019-09-01T00:00:00Z", pushedAt: repo.pushedAt,
    primaryLanguage: repo.language ? { name: repo.language, color: "#3178c6" } : null,
    owner: { avatarUrl: `https://avatars.example/${fullName.split("/")[0]}` },
    repositoryTopics: { nodes: repo.topics.map((name) => ({ topic: { name } })) },
    openIssues: { totalCount: 12 }, closedIssues: { totalCount: 140 }, releases: { totalCount: 6 }, mentionableUsers: { totalCount: 25 },
    defaultBranchRef: { target: { history: { totalCount: 1800 } } },
  };
}

function userNode(login: string) {
  const account = ACCOUNTS[login];
  if (!account) return null;
  return {
    login, avatarUrl: `https://avatars.example/${login}`, createdAt: "2015-08-01T00:00:00Z",
    followers: { totalCount: 30 }, owned: { nodes: [] },
    profile: null,
    stard: account.readme === null
      ? null
      : { readme: { text: account.readme }, character: account.characterFile === undefined ? null : { text: account.characterFile }, noPlay: account.noPlay ? { oid: "d3a9e1" } : null },
    pinnedItems: { nodes: account.pinned.map(repoNode) },
    repositories: { nodes: [] },
    starredRepositories: { nodes: account.stars.map((nameWithOwner) => ({ nameWithOwner, isPrivate: false })) },
    lists: { nodes: (LISTS[login] ?? []).map(({ slug, isPrivate }) => ({ id: listId(login, slug), slug, name: slug.replace(/-/g, " "), isPrivate })) },
  };
}

type List = { slug: string; isPrivate: boolean; repos: string[] };
const listId = (login: string, slug: string) => `UL_${login}_${slug}`;

/** The collector's strongest 36 stars, as a public List for a deck. */
export const STRONG_DECK = "legends";
/** A List the collector keeps private: a deck must never read it. */
export const PRIVATE_DECK = "secret-stash";
const LISTS: Record<string, List[]> = {
  [COLLECTOR]: [
    { slug: STRONG_DECK, isPrivate: false, repos: POPULAR.filter((name) => REPOS[name].stars >= 5000) },
    { slug: PRIVATE_DECK, isPrivate: true, repos: ["greendale/dreamatorium"] },
  ],
};

/** A List's items, as `node(id:) { ... on UserList { items } }` answers them. */
function listNode(id: string) {
  for (const [login, lists] of Object.entries(LISTS)) {
    const list = lists.find((entry) => listId(login, entry.slug) === id);
    if (list) return { items: { nodes: list.repos.map((nameWithOwner) => ({ nameWithOwner, isPrivate: false })) } };
  }
  return null;
}

/** The repos a search finds: those in its `stars:` range, the most stars first. Other qualifiers are ignored. */
function foundBy(search: string): string[] {
  const range = /stars:(\d+)\.\.(\d+)/.exec(search);
  const from = /stars:>=(\d+)/.exec(search);
  const [low, high] = range ? [Number(range[1]), Number(range[2])] : from ? [Number(from[1]), Infinity] : [0, Infinity];
  return Object.keys(REPOS)
    .filter((name) => REPOS[name].stars >= low && REPOS[name].stars <= high)
    .sort((a, b) => REPOS[b].stars - REPOS[a].stars);
}

// Who starred this repo: 150 made-up students, then the host and the Dean (who opted
// out of being played), so the list takes two pages of 100.
const STARGAZERS = [...Array.from({ length: 150 }, (_, i) => `greendale-student-${i + 1}`), "Study-Group-Abed", "Study-Group-Dean"];

/** The REST calls made for this repo's stargazers, one per page asked for. */
export const stargazerCalls: string[] = [];

function stargazers(url: URL): Response {
  stargazerCalls.push(url.search);
  const perPage = Number(url.searchParams.get("per_page") ?? 30);
  const page = Number(url.searchParams.get("page") ?? 1);
  return Response.json(STARGAZERS.slice((page - 1) * perPage, page * perPage).map((login) => ({ login })));
}

/** A stand-in for `fetch` that answers GitHub's GraphQL endpoint and this repo's stargazers. */
export async function fakeGitHub(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.pathname === "/repos/armanckeser/stard/stargazers") return stargazers(url);
  const { query } = JSON.parse(String(init?.body)) as { query: string };
  const user = /user\(login: "([^"]+)"\)/.exec(query);
  if (user) {
    const listed = /HEAD:characters\/([^"]+)\.md/.exec(query);
    const file = listed ? LISTED_FILES[listed[1]] : undefined;
    return Response.json({ data: { user: userNode(user[1]), here: { character: file === undefined ? null : { text: file } } } });
  }
  const list = /node\(id: "([^"]+)"\)/.exec(query);
  if (list) return Response.json({ data: { node: listNode(list[1]) } });
  const data: Record<string, unknown> = {};
  for (const found of query.matchAll(/(b\d+): search\(query: "([^"]+)", type: REPOSITORY, first: (\d+)\)/g)) {
    data[found[1]] = { nodes: foundBy(found[2]).slice(0, Number(found[3])).map((nameWithOwner) => ({ nameWithOwner, stargazerCount: REPOS[nameWithOwner].stars })) };
  }
  for (const found of query.matchAll(/(r\d+): repository\(owner: "([^"]+)", name: "([^"]+)"\)/g)) {
    // GitHub finds a repo whatever the case of its name, and answers with the name as it is.
    const asked = `${found[2]}/${found[3]}`.toLowerCase();
    const name = Object.keys(REPOS).find((key) => key.toLowerCase() === (MOVED[asked] ?? asked));
    data[found[1]] = name ? repoNode(name) : null;
  }
  return Response.json({ data });
}

// Any other account a run asks for (OPPONENTS are real logins) is answered with this
// invented one, so no test depends on what a real account has starred.
const STAND_IN: Account = { readme: null, pinned: ["greendale/human-being"], stars: ["city-college/mascot", "troy-barnes/blanket-fort", "cougar-town/kickpuncher"] };

/** What a fake GitHub was asked: every account whose stars were read, in lower case. */
export type FakeGitHub = { fetch: typeof fetch; usersRead: string[] };

/**
 * A fake GitHub where every account exists (unknown ones get a stand-in) and the
 * accounts in `noPlay` have a `stard` repo with a `no-play` file in it.
 */
export function fakeGitHubWhere(options: { noPlay: readonly string[] }): FakeGitHub {
  const usersRead: string[] = [];
  const noPlay = new Set(options.noPlay.map((login) => login.toLowerCase()));
  const answer = async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (init?.body === undefined) return fakeGitHub(_input, init);
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    const user = /user\(login: "([^"]+)"\)/.exec(query);
    // Wrapped's read: a page of stars with when each was given.
    if (user && query.includes("pageInfo")) {
      usersRead.push(user[1].toLowerCase());
      return starsPage(query);
    }
    if (user) {
      usersRead.push(user[1].toLowerCase());
      const account = ACCOUNTS[user[1]] ?? STAND_IN;
      return Response.json({ data: { user: { ...userNode(HOST)!, ...accountNode(account), login: user[1], avatarUrl: `https://avatars.example/${user[1]}` } } });
    }
    const optOuts = [...query.matchAll(/(o\d+): repository\(owner: "([^"]+)", name: "stard"\)/g)];
    if (optOuts.length > 0) {
      return Response.json({ data: Object.fromEntries(optOuts.map((found) => [found[1], noPlay.has(found[2].toLowerCase()) ? { noPlay: { oid: "a1b2c3" } } : null])) });
    }
    return fakeGitHub(_input, init);
  };
  return { fetch: answer as typeof fetch, usersRead };
}

function accountNode(account: Account) {
  return {
    stard: account.readme === null ? null : { readme: { text: account.readme } },
    lists: { nodes: [] },
    pinnedItems: { nodes: account.pinned.map(repoNode) },
    starredRepositories: { nodes: account.stars.map((nameWithOwner) => ({ nameWithOwner, isPrivate: false })) },
  };
}

/** No such account: a Wrapped read of it finds no user. */
export const NOBODY = "study-group-nobody";
/** Starred 1,293 made-up repos in 2026, more than Wrapped reads, and a few in 2025. */
export const STARGAZER = "study-group-chang";

type StarredEdge = { starredAt: string; node: Record<string, unknown> };

/** Someone's stars with when they were given, newest first, as Wrapped reads them. */
function starredEdges(login: string): StarredEdge[] {
  if (login === STARGAZER) {
    // One every 6 hours back from Nov 20, 2026: 1,293 land in 2026, the rest in 2025.
    return Array.from({ length: 1300 }, (_, i) => ({
      starredAt: new Date(Date.parse("2026-11-20T00:00:00Z") - i * 6 * 3600_000).toISOString(),
      node: { nameWithOwner: `chang-dynasty/star-${i}`, isPrivate: false, stargazerCount: 10 + i, createdAt: "2020-01-01T00:00:00Z", pushedAt: "2026-11-01T00:00:00Z", isArchived: false, primaryLanguage: { name: "Python", color: "#3572A5" } },
    }));
  }
  const account = ACCOUNTS[login] ?? STAND_IN;
  // The account's stars a month apart, the newest in October 2026.
  return account.stars.map((fullName, i) => {
    const node = repoNode(fullName in REPOS ? fullName : "greendale/human-being");
    return { starredAt: new Date(Date.UTC(2026, 9 - i, 15)).toISOString(), node: { ...node, nameWithOwner: fullName, isPrivate: false } };
  });
}

/** One page of 100 of someone's stars, after the cursor (the index of the last one read). */
function starsPage(query: string): Response {
  const login = /user\(login: "([^"]+)"\)/.exec(query)![1];
  if (login === NOBODY) return Response.json({ data: { user: null }, errors: [{ type: "NOT_FOUND", message: `Could not resolve to a User with the login of '${login}'.` }] });
  const after = Number(/after: "(\d+)"/.exec(query)?.[1] ?? -1);
  const edges = starredEdges(login);
  const page = edges.slice(after + 1, after + 101);
  return Response.json({
    data: {
      user: {
        login, avatarUrl: `https://avatars.example/${login}`,
        starredRepositories: { pageInfo: { hasNextPage: after + 101 < edges.length, endCursor: String(after + page.length) }, edges: page },
      },
    },
  });
}

/** A `fetch` for when GitHub can't be reached at all. */
export async function unreachable(): Promise<Response> {
  throw new TypeError("fetch failed: GitHub is unreachable");
}
