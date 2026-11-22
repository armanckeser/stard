import { describe, expect, test } from "vitest";
import { CARD_WIDTH, listCard, matchupCard, messageCard, tapeRows, nameLines, pulseOf, reviewCard, runPreviewCard, savedTeamCard, topFourCard, wrap, type CardRepo, type ShareCard, type ShelfPlayer } from "./cards.ts";
import { fighterFor, type RepoFacts } from "./battle.ts";
import { defaultCharacter } from "./character.ts";
import { creatureRecipe } from "./creature-recipe.ts";

const NOW = Date.parse("2026-11-10T00:00:00Z");

function repoFacts(fullName: string): RepoFacts {
  return {
    fullName, description: null, stars: 5000, forks: 300, language: "Python", color: "#3572A5", avatarUrl: "https://avatars.githubusercontent.com/u/1",
    isArchived: false, createdAt: "2022-01-01T00:00:00Z", pushedAt: "2026-11-07T00:00:00Z", openIssues: 50, closedIssues: 450, releases: 12, contributors: 40, commits: 2000,
  };
}

function repo(fullName: string, extra: Partial<CardRepo> = {}): CardRepo {
  return { fullName, stars: 1234, language: "TypeScript", color: "#3178c6", avatar: null, ...extra };
}

describe("nameLines", () => {
  test("keeps a short name on one line", () => {
    expect(nameLines("uv")).toEqual(["uv"]);
  });

  test("breaks a long name at its hyphens", () => {
    expect(nameLines("build-your-own-x")).toEqual(["build-", "your-own-x"]);
  });

  test("never makes more than four lines", () => {
    expect(nameLines("a-really-long-repository-name-that-keeps-going-on").length).toBeLessThanOrEqual(4);
    expect(nameLines("a-really-long-repository-name-that-keeps-going-on").join("")).toBe("a-really-long-repository-name-that-keeps-going-on");
  });
});

describe("wrap", () => {
  test("wraps at the width and ends a cut-off text with an ellipsis", () => {
    expect(wrap("one two three four five six", 9, 2)).toEqual(["one two", "three…"]);
    expect(wrap("short", 20, 3)).toEqual(["short"]);
  });
});

describe("pulseOf", () => {
  test("a launch month doesn't make the months after it read as dead", () => {
    // witr's real year: 483 in its launch month, then 15 to 90 a month.
    const pulse = pulseOf([267, 483, 58, 78, 2, 50, 84, 51, 18, 3, 91, 14], 12, false);
    expect(Math.min(...pulse)).toBeGreaterThan(0.4);
  });

  test("a repo younger than a year rises from 0 at its start through only the months it has lived", () => {
    const pulse = pulseOf([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20, 41], 2, false);
    expect(pulse).toHaveLength(3);
    expect(pulse[0]).toBe(0);
    expect(pulse[2]).toBeGreaterThan(pulse[1]);
  });

  test("a stray closed issue doesn't lift a dead repo off the floor", () => {
    expect(pulseOf([0, 2, 4, 0, 3, 0], 6, false)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  test("even the busiest repo stays under the top of the line's band", () => {
    expect(Math.max(...pulseOf([10_000, 12_000, 16_000], 3, false))).toBeLessThan(1);
  });

  test("an archived repo is flat whatever its history", () => {
    expect(pulseOf([90, 90, 90], 3, true)).toEqual([0, 0, 0]);
  });
});

describe("a matchup", () => {
  const tape = (extra: Partial<NonNullable<CardRepo["tape"]>> = {}) => ({ forks: 100, license: "MIT", openIssues: 10, closedIssues: 90, lastRelease: "2026-11-01T00:00:00Z", ...extra });

  test("each row leads with the bigger number, the fresher release, and nobody on a tie", () => {
    const a = repo("a/handy", { stars: 39_700, tape: tape({ forks: 3754, openIssues: 58, closedIssues: 813, lastRelease: "2026-11-02T00:00:00Z" }) });
    const b = repo("b/whispr", { stars: 12_000, tape: tape({ forks: 1597, openIssues: 271, closedIssues: 899, lastRelease: "2026-11-05T00:00:00Z" }) });
    const rows = tapeRows(a, b, NOW);
    expect(rows.map((r) => r.lead)).toEqual(["a", "a", "a", "b", null]);
    expect(rows[2]).toMatchObject({ a: "93%", b: "77%" });
    expect(rows[3]).toMatchObject({ a: "8 days ago", b: "5 days ago" });
    expect(tapeRows(a, repo("c/same", { stars: 39_700, tape: tape() }), NOW)[0].lead).toBeNull();
  });

  test("a repo with no release or issues loses those rows instead of breaking them", () => {
    const rows = tapeRows(repo("a/new", { tape: tape({ lastRelease: null, openIssues: 0, closedIssues: 0 }) }), repo("b/old", { tape: tape() }), NOW);
    expect(rows[2]).toMatchObject({ a: "no issues", lead: "b" });
    expect(rows[3]).toMatchObject({ a: "none", lead: "b" });
  });

  test("the card brightens only the leading side and escapes the topic", () => {
    const svg = matchupCard("<dictation>", repo("a/handy", { stars: 2, tape: tape() }), repo("b/whispr", { stars: 1, tape: tape() }), NOW);
    expect(svg).toContain("MATCHUP · &lt;DICTATION&gt;");
    expect(svg).toContain('font-weight="700" fill="#f2f0eb">2</text>');
    expect(svg).toContain('font-weight="400" fill="#6e7681">1</text>');
  });
});

describe("the cards", () => {
  test("the top four names every repo, fills the stars given and leaves an outline for a missing poster", () => {
    const svg = topFourCard("octo", [repo("a/one"), repo("b/two"), repo("c/three")], [5, 4.5, null]);
    expect(svg).toContain(`width="${CARD_WIDTH}"`);
    expect(svg).toContain("OCTO’S TOP FOUR");
    expect(svg).toContain("octo’s top four repos on GitHub: a/one, b/two, c/three");
    for (const name of ["one", "two", "three"]) expect(svg).toContain(`>${name}</text>`);
    expect(svg).toContain("stroke-dasharray");
    // 5 and 4.5 stars: nine whole yellow stars, one half, and the watermark's star.
    expect(svg.match(/<polygon[^>]*fill="#f5c84b"/g)).toHaveLength(11);
    expect(svg).toContain(">stard</text>");
  });

  test("the top four has no row of stars when nothing is rated", () => {
    const rated = topFourCard("octo", [repo("a/one")], [4]);
    const unrated = topFourCard("octo", [repo("a/one")]);
    expect(unrated).not.toContain('fill="#30363d"');
    expect(Number(/height="(\d+)"/.exec(unrated)![1])).toBeLessThan(Number(/height="(\d+)"/.exec(rated)![1]));
  });

  test("text a person typed can't add markup", () => {
    const svg = reviewCard("octo", repo("a/one"), 4, `</text><script>alert("x")</script> & more`);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain("&amp; more");
  });

  test("a review holds at most four lines of text", () => {
    const svg = reviewCard("octo", repo("a/one"), null, "word ".repeat(300));
    expect(svg.match(/font-size="16"/g)).toHaveLength(4);
    expect(svg).toContain("Reviewed by octo");
  });

  test("a poster puts dark ink on a light colour and light ink on a dark one", () => {
    expect(topFourCard("octo", [repo("a/light", { color: "#f1e05a" })])).toContain('fill="#14171a">light</text>');
    expect(topFourCard("octo", [repo("a/dark", { color: "#083fa1" })])).toContain('fill="#ffffff">dark</text>');
    expect(topFourCard("octo", [repo("a/none", { color: null })])).toContain('fill="#3a4049"');
  });

  test("a List card shows the name, the count and at most six posters", () => {
    const svg = listCard("octo", "Run your server", 28, Array.from({ length: 8 }, (_, i) => repo(`o/r${i}`)));
    expect(svg).toContain(">Run your server</text>");
    expect(svg).toContain("A list by octo · 28 repos");
    expect(svg).toContain(">r5</text>");
    expect(svg).not.toContain(">r6</text>");
  });

  test("a poster with a pulse splits into grey and colour, with the star count in grey's ink", () => {
    const svg = reviewCard("octo", repo("a/light", { color: "#f1e05a", pulse: [1, 0.5, 0] }), 4, "");
    expect(svg).toMatch(/<path d="M[^"]+Z" fill="#f1e05a"\/>/);
    expect(svg).toContain('fill="#ffffff" fill-opacity="0.8">★');
    expect(svg).toContain('fill="#14171a">light</text>');
    expect(reviewCard("octo", repo("a/flat"), 4, "")).not.toContain("<path");
  });

  test("a card that can't be drawn says why", () => {
    expect(messageCard("This card has no repos to show.")).toContain("This card has no repos to show.");
  });
});

describe("the run's share picture", () => {
  const player = (cards: ShareCard[]): ShelfPlayer => ({
    login: "troybarnes",
    name: "Troy",
    klass: "Scout",
    look: defaultCharacter("troybarnes").look,
    avatar: null,
    cards,
  });
  const card = (name: string, cost = 1): ShareCard => ({ name, cost, sets: ["data"], creature: null });

  test("names the player and their first four cards, at link-preview size, when a player is given", () => {
    // Regression guarded: a /run?me= link previewed someone else's run, or a fifth card ran off the picture.
    const svg = runPreviewCard(player([card("dreamatorium"), card("paintball"), card("blanketfort"), card("koosh"), card("chang")]), "Space Grotesk");
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain(`aria-label="Play Stard with troybarnes&#39;s stars"`);
    expect(svg).toContain(">troybarnes</text>");
    expect(svg).toContain(">Scout · Troy</text>");
    for (const name of ["dreamatorium", "paintball", "blanketfort", "koosh"]) expect(svg).toContain(`>${name}</text>`);
    expect(svg).not.toContain(">chang</text>");
  });

  test("keeps the run's rules off the picture, when a player is given", () => {
    // Regression guarded: the picture repeated the sentences the link preview's description already shows under it.
    const svg = runPreviewCard(player([card("dreamatorium")]), "Space Grotesk");
    expect(svg).toContain(">Play Stard</text>");
    expect(svg).not.toContain("5 wins finishes a run");
    expect(svg).not.toContain("No sign-in");
  });

  test("draws each card's creature and no owner avatar, when the cards have creatures", () => {
    // Regression guarded: a card's art showed the repo owner's avatar where the game shows its creature.
    const cards = ["greendale/dreamatorium", "greendale/paintball"].map((fullName): ShareCard => ({ ...card(fullName.split("/")[1]), creature: creatureRecipe(fighterFor(repoFacts(fullName), "greendale", NOW)) }));
    const svg = runPreviewCard(player(cards), "Space Grotesk");
    expect(svg.match(/viewBox="-1 -1 2 2"/g)).toHaveLength(2);
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("NaN");
  });

  test("marks each set's hex with its icon or a hash, when cards carry a family, a common topic and an uncommon topic", () => {
    // Regression guarded: the hexes beside the set names were drawn empty.
    const svg = runPreviewCard(player([{ ...card("troy-cli"), sets: ["data", "cli"] }, { ...card("paintball"), sets: ["paintball-league"] }]), "Space Grotesk");
    expect(svg).toContain('d="m4 17 6-6-6-6"');
    expect(svg).toContain('d="M13 17V5"');
    expect(svg).toContain('x1="4" x2="20" y1="9" y2="9"');
    expect(svg).not.toContain('key="');
  });

  test("colours a card's border with its cost's tier and nothing else, when cards of two costs are shown", () => {
    // Regression guarded: the tier colour leaked onto the picture as decoration, or a card lost its tier.
    const svg = runPreviewCard(player([card("dreamatorium", 5), card("paintball", 2)]), "Space Grotesk");
    expect(svg.match(/#e3b341/g)).toHaveLength(1);
    expect(svg.match(/#3fb950/g)).toHaveLength(1);
    expect(svg).toContain('stroke="#e3b341" stroke-width="2"');
    expect(svg).not.toContain("Gradient");
  });

  test("shows the run for anyone, a blank card of each cost and no username, when no player is given", () => {
    const svg = runPreviewCard(null, "Space Grotesk");
    expect(svg).toContain('aria-label="Play Stard with your GitHub stars"');
    expect(svg).toContain(">Play Stard</text>");
    for (const tier of ["#8b949e", "#3fb950", "#4a90d9", "#a371f7", "#e3b341"]) expect(svg).toContain(`stroke="${tier}"`);
    expect(svg).not.toContain("troybarnes");
  });

  test("a repo name can't add markup to the picture", () => {
    const svg = runPreviewCard(player([card("<script>x")]), "Space Grotesk");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;x");
  });
});

describe("a saved team's share picture", () => {
  const card = (name: string, cost = 1): ShareCard => ({ name, cost, sets: ["data"], creature: null });
  const player = (cards: ShareCard[]): ShelfPlayer => ({ login: "greendale", name: "greendale", klass: "Rookie", look: defaultCharacter("greendale").look, avatar: null, cards });

  test("draws a finished run at link-preview size with the record as the title and every card, when the team has five", () => {
    // Regression guarded: the record or a card of the final team went missing from the preview.
    const svg = savedTeamCard(player(["troy", "abed", "annie", "britta", "shirley"].map((name) => card(name))), 5, 1, "Space Grotesk");
    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain('aria-label="greendale&#39;s team: 5 wins, 1 loss"');
    expect(svg).toContain(">5 wins, 1 loss</text>");
    for (const name of ["troy", "abed", "annie", "britta", "shirley"]) expect(svg).toContain(`>${name}</text>`);
  });

  test("keeps the team's sentences off the picture, when a team is drawn", () => {
    // Regression guarded: the picture repeated the link preview's description over the shelf.
    const svg = savedTeamCard(player([card("dreamatorium")]), 5, 2, "Space Grotesk");
    expect(svg).not.toContain("Beat it with yours");
    expect(svg).not.toContain("as it stood that round");
  });

  test("says one win and no losses in the singular and plural, when the run won once", () => {
    const svg = savedTeamCard(player([card("dreamatorium")]), 1, 0, "Space Grotesk");
    expect(svg).toContain(">1 win, 0 losses</text>");
  });

  test("keeps a rookie's class line off the picture, when the character was never built", () => {
    const svg = savedTeamCard(player([card("dreamatorium", 3)]), 3, 3, "Space Grotesk");
    expect(svg).not.toContain("Rookie");
    expect(svg).toContain('stroke="#4a90d9" stroke-width="2"');
  });
});
