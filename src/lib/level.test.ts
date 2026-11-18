// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { LEVELS } from "../../server/run/opponent";
import { playLevel, rememberWin } from "./level";

// Regression guarded: every run met the same opponents, so a first run was as hard as the
// hundredth. A browser plays level 1 until it has won a run.

describe("the level a browser plays", () => {
  beforeEach(() => localStorage.clear());

  it("is 1 until a run is won, then the hardest level", () => {
    expect(playLevel()).toBe(1);
    rememberWin();
    expect(playLevel()).toBe(LEVELS.length);
  });
});
