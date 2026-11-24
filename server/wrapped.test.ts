import { describe, expect, test } from "vitest";
import { alivePercent, countText, summaryLine, wrappedStats, type StarEdge } from "./wrapped.ts";

const NOW = Date.parse("2026-11-24T12:00:00Z");

function edge(starredAt: string, extra: Partial<StarEdge["node"]> = {}): StarEdge {
  return {
    starredAt,
    node: {
      nameWithOwner: `greendale/${starredAt}`,
      stargazerCount: 100,
      createdAt: "2020-01-01T00:00:00Z",
      pushedAt: "2026-11-01T00:00:00Z",
      isArchived: false,
      primaryLanguage: { name: "Rust", color: "#dea584" },
      ...extra,
    },
  };
}

describe("wrappedStats", () => {
  test("counts only stars given in 2026, by the UTC calendar", () => {
    // Regression guarded: a star at 23:30 on Dec 31 in New York (04:30 UTC Jan 1) being counted in the year it was given locally.
    const stats = wrappedStats(
      [edge("2025-12-31T23:59:59Z"), edge("2026-01-01T00:00:00Z"), edge("2026-12-31T23:59:59Z"), edge("2027-01-01T04:30:00Z")],
      NOW,
    );
    expect(stats.count).toBe(2);
    expect(stats.months[0]).toBe(1);
    expect(stats.months[11]).toBe(1);
  });

  test("the busiest month is the earliest of a tie", () => {
    const stats = wrappedStats([edge("2026-03-02T00:00:00Z"), edge("2026-05-02T00:00:00Z"), edge("2026-03-09T00:00:00Z"), edge("2026-05-09T00:00:00Z")], NOW);
    expect(stats.busiest).toBe(2);
  });

  test("ranks languages by stars, then by name, and keeps three", () => {
    const languages = ["Go", "Python", "Go", "Python", "Zig", "Elm", "Rust", "Rust"].map((name, i) => edge(`2026-02-${String(i + 1).padStart(2, "0")}T00:00:00Z`, { primaryLanguage: { name, color: null } }));
    const stats = wrappedStats([...languages, edge("2026-02-20T00:00:00Z", { primaryLanguage: null })], NOW);
    expect(stats.languages.map((language) => language.name)).toEqual(["Go", "Python", "Rust"]);
  });

  test("the early find is the most-starred repo starred within 30 days of being made", () => {
    const stats = wrappedStats(
      [
        edge("2026-04-10T00:00:00Z", { nameWithOwner: "greendale/young", createdAt: "2026-04-01T00:00:00Z", stargazerCount: 41_200 }),
        edge("2026-04-10T00:00:00Z", { nameWithOwner: "greendale/younger", createdAt: "2026-04-09T00:00:00Z", stargazerCount: 900 }),
        edge("2026-04-10T00:00:00Z", { nameWithOwner: "greendale/too-old", createdAt: "2026-03-01T00:00:00Z", stargazerCount: 90_000 }),
      ],
      NOW,
    );
    expect(stats.earlyFind).toEqual({ fullName: "greendale/young", stars: 41_200, daysOld: 9 });
  });

  test("has no early find when every star went to an older repo", () => {
    expect(wrappedStats([edge("2026-04-10T00:00:00Z")], NOW).earlyFind).toBeNull();
  });

  test("a repo is still alive when it was pushed to in the last 90 days and isn't archived", () => {
    const stats = wrappedStats(
      [
        edge("2026-04-10T00:00:00Z"),
        edge("2026-04-11T00:00:00Z", { isArchived: true }),
        edge("2026-04-12T00:00:00Z", { pushedAt: "2026-07-01T00:00:00Z" }),
        edge("2026-04-13T00:00:00Z", { pushedAt: null }),
      ],
      NOW,
    );
    expect(stats.alive).toBe(1);
    expect(alivePercent(stats)).toBe(25);
  });

  test("a year with no stars has nothing to show and says so", () => {
    const stats = wrappedStats([edge("2025-06-01T00:00:00Z")], NOW);
    expect(stats).toMatchObject({ count: 0, busiest: null, languages: [], earlyFind: null, alive: 0 });
    expect(alivePercent(stats)).toBeNull();
    expect(summaryLine(stats)).toBe("No public stars in 2026 yet.");
  });

  test("says so far until the year is over", () => {
    expect(wrappedStats([], NOW).soFar).toBe(true);
    expect(wrappedStats([], Date.parse("2027-01-01T00:00:00Z")).soFar).toBe(false);
  });
});

test("a capped count reads 1,000+", () => {
  expect(countText({ count: 1000, capped: true })).toBe("1,000+");
  expect(countText({ count: 412, capped: false })).toBe("412");
});

test("the summary line names the count, the top language and the busiest month", () => {
  const stats = wrappedStats([edge("2026-03-02T00:00:00Z"), edge("2026-03-03T00:00:00Z")], NOW);
  expect(summaryLine(stats)).toBe("2 repos, mostly Rust, peak in March.");
});
