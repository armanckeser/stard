import { describe, expect, it } from "vitest";
import { battleText, beatLine, beatenIn, challengeMessage, type RoundResult } from "./challenge";

// The end screen's words: who a run beat, and the challenge it copies.

const LINK = "https://stard.example/team?t=the-token";

describe("beatLine", () => {
  it.each([
    [["abed"], "You beat abed"],
    [["abed", "annie"], "You beat abed and annie"],
    [["abed", "annie", "troy"], "You beat abed, annie and troy"],
    [["abed", "annie", "troy", "britta", "shirley"], "You beat abed, annie, troy and 2 more"],
  ])("names %j as %s", (beaten, line) => {
    // Regression guarded: a five-win run listing every name, which wraps the end screen's lead line on a phone.
    expect(beatLine(beaten)).toBe(line);
  });

  it("has no line for a run that beat nobody", () => {
    expect(beatLine([])).toBeNull();
  });
});

describe("beatenIn", () => {
  it("keeps the won rounds' opponents, each once, in the order they were beaten", () => {
    // Regression guarded: a run against one saved team reading "You beat abed, abed and abed".
    const results: RoundResult[] = [
      { round: 1, opponent: "annie", outcome: "lost" },
      { round: 2, opponent: "abed", outcome: "won" },
      { round: 3, opponent: "troy", outcome: "draw" },
      { round: 4, opponent: "abed", outcome: "won" },
      { round: 5, opponent: "britta", outcome: "won" },
    ];
    expect(beatenIn(results)).toEqual(["abed", "britta"]);
  });
});

describe("battleText", () => {
  // Regression guarded: a battle posted on X tagging the strangers who own the X handles matching the GitHub usernames.
  it("names both sides bare, with the cards the winner kept", () => {
    expect(battleText("abed", "troy", 1)).toBe("abed beat troy with 1 card left in a battle of GitHub stars on Stard.");
  });
});

describe("challengeMessage", () => {
  it("names the friend and puts them on the link", () => {
    expect(challengeMessage(["abed", "troy"], LINK, "annie")).toBe("I beat abed and troy with my GitHub stars on Stard. annie, beat my team: https://stard.example/team?t=the-token&to=annie");
  });

  it("leaves the friend out of the words and the link when no friend is named", () => {
    expect(challengeMessage(["abed"], LINK, "")).toBe("I beat abed with my GitHub stars on Stard. Beat my team: https://stard.example/team?t=the-token");
  });

  it("claims no win for a run that beat nobody", () => {
    expect(challengeMessage([], LINK, "annie")).toBe("I drafted a team from my GitHub stars on Stard. annie, beat my team: https://stard.example/team?t=the-token&to=annie");
  });

  // Regression guarded: a challenge posted on X tagging strangers who own the X handles matching the GitHub usernames.
  it("puts no @ before any username", () => {
    for (const friend of ["", "annie"]) expect(challengeMessage(["abed", "troy", "britta", "shirley"], LINK, friend)).not.toContain("@");
  });
});
