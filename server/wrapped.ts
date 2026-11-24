// "Your 2026 in stars": a year of someone's public GitHub stars, summed up. Pure: the
// starred edges GitHub returns in, the numbers the card and page show out. The Worker
// reads the edges and draws the card (worker/src/wrapped.ts, server/cards.ts).
//
// Every date is counted in UTC, so a star given at 23:30 on Dec 31 in New York is a
// 2027 star, the way GitHub's own timestamps put it.

/** The year Wrapped covers. Other years are out of scope. */
export const WRAPPED_YEAR = 2026;

const DAY_MS = 86_400_000;
/** A repo starred at most this many days after it was made is an early find. */
export const EARLY_DAYS = 30;
/** A repo pushed to within this many days, and not archived, is still alive. */
export const ALIVE_DAYS = 90;

/** One starred repo, as `starredRepositories { edges { starredAt node { ... } } }` answers it. */
export type StarEdge = {
  starredAt: string;
  node: {
    nameWithOwner: string;
    stargazerCount: number;
    createdAt: string;
    pushedAt: string | null;
    isArchived: boolean;
    primaryLanguage: { name: string; color: string | null } | null;
  };
};

export type WrappedLanguage = { name: string; color: string | null; count: number };
export type EarlyFind = { fullName: string; stars: number; daysOld: number };

export type WrappedStats = {
  year: number;
  /** Stars given in the year, or the most that were read when `capped`. */
  count: number;
  /** More stars than were read: the count is shown as "1,000+". */
  capped: boolean;
  /** Before the year is over, the card says "so far". */
  soFar: boolean;
  /** Stars per month, January first. */
  months: number[];
  /** The month with the most stars (0 is January), the earliest on a tie; null with no stars. */
  busiest: number | null;
  /** The top three languages, most stars first, then by name. */
  languages: WrappedLanguage[];
  /** The most-starred repo starred within EARLY_DAYS of being made. */
  earlyFind: EarlyFind | null;
  /** How many of the year's stars were pushed in the last ALIVE_DAYS and aren't archived. */
  alive: number;
};

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Whether a page of stars, newest first, reached back past the start of the year. */
export const reachedBefore = (edges: StarEdge[], year: number) => edges.some((edge) => Date.parse(edge.starredAt) < Date.UTC(year, 0, 1));

/**
 * The year's numbers from a person's starred repos.
 *
 * Args:
 *   edges: Starred repos in any order; those starred outside the year are ignored.
 *   now: The time now (epoch ms), for "so far" and for whether a repo is still alive.
 *   capped: True when there were more stars in the year than were read.
 *   year: The year to sum up.
 */
export function wrappedStats(edges: StarEdge[], now: number, capped = false, year = WRAPPED_YEAR): WrappedStats {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  const inYear = edges.filter((edge) => {
    const at = Date.parse(edge.starredAt);
    return at >= start && at < end;
  });

  const months = Array.from({ length: 12 }, () => 0);
  for (const edge of inYear) months[new Date(edge.starredAt).getUTCMonth()] += 1;
  const most = Math.max(...months);
  const busiest = most > 0 ? months.indexOf(most) : null;

  const byLanguage = new Map<string, WrappedLanguage>();
  for (const { node } of inYear) {
    if (!node.primaryLanguage) continue;
    const seen = byLanguage.get(node.primaryLanguage.name) ?? { name: node.primaryLanguage.name, color: node.primaryLanguage.color, count: 0 };
    seen.count += 1;
    byLanguage.set(seen.name, seen);
  }
  const languages = [...byLanguage.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)).slice(0, 3);

  let earlyFind: EarlyFind | null = null;
  for (const { starredAt, node } of inYear) {
    const daysOld = Math.floor((Date.parse(starredAt) - Date.parse(node.createdAt)) / DAY_MS);
    if (!(daysOld >= 0 && daysOld <= EARLY_DAYS)) continue;
    const better = !earlyFind || node.stargazerCount > earlyFind.stars || (node.stargazerCount === earlyFind.stars && node.nameWithOwner < earlyFind.fullName);
    if (better) earlyFind = { fullName: node.nameWithOwner, stars: node.stargazerCount, daysOld };
  }

  const alive = inYear.filter(({ node }) => !node.isArchived && node.pushedAt !== null && now - Date.parse(node.pushedAt) <= ALIVE_DAYS * DAY_MS).length;

  return { year, count: inYear.length, capped, soFar: now < end, months, busiest, languages, earlyFind, alive };
}

/** "1,000+" for a capped count, else the count with a thousands comma. */
export const countText = (stats: Pick<WrappedStats, "count" | "capped">) => `${stats.count.toLocaleString("en-US")}${stats.capped ? "+" : ""}`;

/** The share of the year's stars still alive, as a whole percent; null with no stars. */
export const alivePercent = (stats: Pick<WrappedStats, "count" | "alive">) => (stats.count > 0 ? Math.round((stats.alive / stats.count) * 100) : null);

/** One line for a post: "412 repos, mostly Rust, peak in March." */
export function summaryLine(stats: WrappedStats): string {
  if (stats.count === 0) return `No public stars in ${stats.year} yet.`;
  const parts = [`${countText(stats)} ${stats.count === 1 ? "repo" : "repos"}`];
  if (stats.languages[0]) parts.push(`mostly ${stats.languages[0].name}`);
  if (stats.busiest !== null && stats.count > 1) parts.push(`peak in ${MONTHS[stats.busiest]}`);
  return `${parts.join(", ")}.`;
}
