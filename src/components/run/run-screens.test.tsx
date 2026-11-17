// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { poolFor } from "../../../e2e/pool";
import { APP_URL } from "@/lib/published-list";
import { choicesFor } from "@/lib/choices";
import type { RoundResult } from "@/lib/challenge";
import { Route as TeamRoute } from "@/routes/team";
import { Checks } from "./checks";
import { FpsMeter } from "./fps-meter";
import { Customize } from "./customize";
import { RunEnd } from "./run-end";

// The Play screens' words and buttons, drawn without the 3D board. These were browser tests;
// the board itself is covered by the one browser smoke test (e2e/run.e2e.ts, @smoke).

const TOKEN = "abeds-team-token";
vi.mock("@/lib/saved-team", async (real) => ({ ...(await real<typeof import("@/lib/saved-team")>()), saveTeam: async () => ({ token: TOKEN }) }));
vi.mock("@/lib/events", () => ({ countEvent: () => {} }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the checks", () => {
  it("names the cards on the board that fill a set", () => {
    // Regression guarded: the hover gave a set's bonus but not which cards were in it,
    // so a player couldn't tell what to keep or swap to finish the set.
    const ace = poolFor("abed").team[0];
    render(<Checks title="Checks" cards={[ace.card]} boosts={[]} />);
    const tips = screen.getAllByTestId("set-bonus").map((row) => row.querySelector("[role=tooltip]")?.textContent ?? "");
    expect(tips.some((tip) => tip.includes(ace.fullName.split("/")[1]))).toBe(true);
  });
});

describe("the end screen", () => {
  const won = ["simonw", "antfu", "tj", "gaearon", "torvalds"];
  const results: RoundResult[] = won.map((opponent, i) => ({ round: i + 1, opponent, outcome: "won" }));

  beforeEach(() => {
    const written: string[] = [];
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: async (text: string) => void written.push(text), written } });
  });

  it("names who the run beat, and copies a challenge with the friend on the link", async () => {
    // Regression guarded: a run's end was a dead end, with no one named and nothing to send a friend.
    const player = poolFor("abed");
    render(<RunEnd player={player} seed="greendale" rounds={[]} results={results} team={[{ fighter: player.team[0], col: 1, row: 0 }]} wins={5} losses={0} onNewRun={() => {}} />);
    expect(screen.getByText("Run finished")).toBeTruthy();
    expect(screen.getByText("You beat @simonw, @antfu, @tj and 2 more")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Friend's GitHub username"), { target: { value: "@annie" } });
    const challenge = await screen.findByRole("button", { name: "Challenge a friend" });
    await vi.waitFor(() => expect((challenge as HTMLButtonElement).disabled).toBe(false));
    await act(async () => fireEvent.click(challenge));
    const written = (navigator.clipboard as unknown as { written: string[] }).written;
    expect(written).toEqual([`I beat @simonw, @antfu, @tj and 2 more with my GitHub stars on Stard. @annie, beat my team: ${APP_URL}team?t=${TOKEN}&to=annie`]);
  });
});

describe("Customize your team", () => {
  // A pick reads the cards it deals; no test reaches the network.
  beforeEach(() => vi.stubGlobal("fetch", async () => new Response(JSON.stringify(poolFor("abed")))));

  it("keeps the picked deck, ace and class for the next run", async () => {
    localStorage.clear();
    const player = { ...poolFor("abed"), decks: [{ slug: "web-tools", name: "Web tools" }], aces: poolFor("abed").team.slice(0, 2).map((fighter) => fighter.fullName) };
    render(<RunEnd player={player} seed="greendale" rounds={[]} results={[]} team={[]} wins={1} losses={3} onNewRun={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Customize your team" })));
    const sheet = await screen.findByRole("dialog", { name: "Customize your team" });
    fireEvent.change(sheet.querySelector("#pick-Deck")!, { target: { value: "web-tools" } });
    fireEvent.change(sheet.querySelector("#pick-Ace")!, { target: { value: player.aces[1] } });
    fireEvent.click(screen.getByRole("radio", { name: /Scout/ }));
    expect(choicesFor("abed")).toMatchObject({ deck: "web-tools", ace: player.aces[1], klass: "scout" });
  });

  // Regression guarded: picking a deck, then pressing Play, read the player's stars a second time.
  it("reads the cards a picked deck deals as soon as it's picked", async () => {
    localStorage.clear();
    const asked: string[] = [];
    const fake = async (url: URL | string) => {
      asked.push(String(url));
      return new Response(JSON.stringify(poolFor("abed")));
    };
    vi.stubGlobal("fetch", fake);
    const player = { ...poolFor("abed"), decks: [{ slug: "cli-tools", name: "CLI tools" }] };
    render(<RunEnd player={player} seed="greendale" rounds={[]} results={[]} team={[]} wins={1} losses={3} onNewRun={() => {}} />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Customize your team" })));
    const sheet = await screen.findByRole("dialog", { name: "Customize your team" });
    fireEvent.change(sheet.querySelector("#pick-Deck")!, { target: { value: "cli-tools" } });
    expect(asked.some((url) => url.includes("/api/run/pool") && url.includes("deck=cli-tools"))).toBe(true);
  });

  // Regression guarded: the sheet stayed shut until the stars were read, several seconds on a cold read.
  it("opens on the Play screen before the stars are read, with the look ready to change", async () => {
    localStorage.clear();
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    render(<Customize login="annie" />);
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Customize your team" })));
    const sheet = await screen.findByRole("dialog", { name: "Customize your team" });
    fireEvent.click(screen.getByRole("radio", { name: /Scout/ }));
    expect(choicesFor("annie")).toMatchObject({ klass: "scout" });
    expect(sheet.querySelector<HTMLSelectElement>("#pick-Deck")!.disabled).toBe(true);
  });
});

describe("a team link", () => {
  const validate = TeamRoute.options.validateSearch as (search: Record<string, unknown>) => { t?: string; to?: string };
  const search = (to: string) => validate({ t: TOKEN, to });

  it("keeps the friend a challenge names", () => {
    expect(search("annie")).toEqual({ t: TOKEN, to: "annie" });
  });

  it("greets no one when the friend isn't a username", () => {
    expect(search("<b>annie").to).toBeUndefined();
  });
});

describe("the frame counter", () => {
  it("shows with ?fps=1 and not without", () => {
    window.history.replaceState(null, "", "/run?fps=1");
    render(<FpsMeter />);
    expect(screen.getByTestId("fps").textContent).toMatch(/fps$/);
    cleanup();
    window.history.replaceState(null, "", "/run");
    render(<FpsMeter />);
    expect(screen.queryByTestId("fps")).toBeNull();
  });
});
