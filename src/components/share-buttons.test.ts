import { describe, expect, it } from "vitest";
import { xPostLink } from "./share-buttons";

describe("xPostLink", () => {
  // Regression guarded: a battle link's "&b=" and "&d=" read by X as more of the post box's own fields, cutting the link short.
  it("keeps the whole battle link and the words in their own fields", () => {
    const link = new URL(xPostLink("abed beat troy & won", "https://stard.example/battle?a=abed&b=troy&d=2026-11-01&play=1"));
    expect(link.origin + link.pathname).toBe("https://x.com/intent/post");
    expect(link.searchParams.get("text")).toBe("abed beat troy & won");
    expect(link.searchParams.get("url")).toBe("https://stard.example/battle?a=abed&b=troy&d=2026-11-01&play=1");
  });
});
