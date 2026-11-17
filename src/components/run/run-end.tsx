import { useEffect, useRef, useState } from "react";
import { Check, Link2, RotateCcw, Swords } from "lucide-react";
import { StarStard } from "@/components/star-stard";
import { Customize } from "@/components/run/customize";
import { TeamTiles } from "@/components/run/team-tiles";
import { Input } from "@/components/ui/input";
import { beatLine, beatenIn, challengeLink, challengeMessage, type RoundResult } from "@/lib/challenge";
import { countEvent } from "@/lib/events";
import { APP_URL, validLogin } from "@/lib/published-list";
import { WINS_TO_FINISH, type Player, type Unit } from "@/lib/run";
import { recordOf, saveTeam, teamLink } from "@/lib/saved-team";
import type { Snapshot } from "../../../server/run/types";

// The end of a run, over the dimmed board (docs/GAME-UI.md §1, §2): one slate panel
// with the gold line on its edge, who the run beat, the record, the team as shop cards,
// Challenge a friend as the only filled button, and the rest quiet under it.

type Saving = { state: "saving" } | { state: "saved"; link: string } | { state: "failed"; message: string; retry: boolean };

// How long "Copied" shows before the button reads as itself again.
const COPIED_FOR = 1500;
// Saves tried again by themselves after a network failure, the first RETRY_AFTER ms later, the next twice that.
const AUTO_RETRIES = 2;
const RETRY_AFTER = 2000;

/**
 * The end of a run: who it beat, the record, the team it ended with, and a challenge
 * to beat that team. The Worker plays the run's fights again before it hands back the
 * team's link (worker/src/team.ts).
 */
export function RunEnd({ player, seed, rounds, results, team, wins, losses, against, onNewRun }: {
  /** Whose run it was, as it was dealt: their pool choice and character go into the team's link. */
  player: Player;
  /** The run's seed, which the Worker replays the fights with. */
  seed: string;
  /** The team as fought at each round, round 1 first. */
  rounds: Snapshot[];
  /** Each round's opponent and how it went. */
  results: RoundResult[];
  team: Unit[];
  wins: number;
  losses: number;
  /** The saved team's token, when the run was played against one. */
  against?: string;
  onNewRun: () => void;
}) {
  const [saving, setSaving] = useState<Saving>({ state: "saving" });
  // A phone that drops its connection for a moment fails the save at once, so a network
  // failure is tried again on its own before the player is asked to.
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    let retry: number | undefined;
    setSaving({ state: "saving" });
    saveTeam(player, seed, rounds, against)
      .then(({ token }) => live && setSaving({ state: "saved", link: teamLink(token) }))
      .catch((cause: unknown) => {
        if (!live) return;
        // fetch rejects with a TypeError only when no answer arrived; a refusal from the Worker is final.
        const unreached = cause instanceof TypeError;
        if (unreached && attempt < AUTO_RETRIES) retry = window.setTimeout(() => setAttempt(attempt + 1), RETRY_AFTER * (attempt + 1));
        else setSaving({ state: "failed", message: unreached || !(cause instanceof Error) ? "Couldn't reach Stard to save your team." : cause.message, retry: unreached });
      });
    return () => {
      live = false;
      window.clearTimeout(retry);
    };
  }, [player, seed, rounds, against, attempt]);
  const beaten = beatenIn(results);
  const lead = beatLine(beaten);
  const newRun = <button type="button" className="hud-button run-panel-link" onClick={onNewRun}><RotateCcw className="size-4" /> New run</button>;

  return (
    <section className="run-panel run-end" aria-labelledby="run-end-title">
      <header className="text-center">
        <h2 id="run-end-title" className="run-panel-title">{wins >= WINS_TO_FINISH ? "Run finished" : "Run over"}</h2>
        {lead && <p className="run-panel-beat">{lead}</p>}
        <p className="run-panel-record">{recordOf(wins, losses)}</p>
      </header>
      <div>
        <p className="run-panel-label">Final team</p>
        <TeamTiles units={team} />
      </div>
      {saving.state === "failed" ? (
        // With no team link there is nothing to challenge with, so starting again leads.
        <button type="button" className="hud-button hud-fight run-panel-primary" onClick={onNewRun}><RotateCcw className="size-4" /> New run</button>
      ) : (
        <Challenge beaten={beaten} link={saving.state === "saved" ? saving.link : null} />
      )}
      <div className="run-panel-quiet">
        {saving.state === "failed" ? <CopyLink text={`${APP_URL}run`} label="Copy Play link" /> : <Customize login={player.login} player={player} />}
        {saving.state !== "failed" && newRun}
        <StarStard className="text-white/55 hover:text-white" />
      </div>
      {saving.state === "failed" && (
        <p className="run-panel-note text-center" role="alert">
          {saving.message}
          {saving.retry && <> <button type="button" className="underline underline-offset-2 hover:text-white" onClick={() => setAttempt((n) => n + 1)}>Try again</button></>}
        </p>
      )}
    </section>
  );
}

type Copying = { state: "ready" } | { state: "copied" } | { state: "failed"; link: string };

/** A friend's username and the button that copies the challenge; waits for the team's link. */
function Challenge({ beaten, link }: { beaten: string[]; link: string | null }) {
  const [friend, setFriend] = useState("");
  const [copying, setCopying] = useState<Copying>({ state: "ready" });
  const reset = useResetTimer();
  const named = friend.trim();
  const nameOk = named === "" || validLogin(named);

  async function copy() {
    if (!link || !nameOk) return;
    try {
      await navigator.clipboard.writeText(challengeMessage(beaten, link, named));
    } catch {
      // A browser that refuses the clipboard still lets the link be selected by hand.
      return setCopying({ state: "failed", link: challengeLink(link, named) });
    }
    countEvent("challenge_copied");
    setCopying({ state: "copied" });
    reset(() => setCopying({ state: "ready" }));
  }

  return (
    <form className="run-challenge" onSubmit={(event) => { event.preventDefault(); void copy(); }}>
      <div className="run-challenge-name">
        <span aria-hidden="true">@</span>
        <Input value={friend} onChange={(event) => setFriend(event.target.value.replace(/^@/, ""))} placeholder="Friend's username" aria-label="Friend's GitHub username" aria-invalid={!nameOk} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
      </div>
      <button type="submit" className="hud-button hud-fight run-panel-primary" disabled={!link || !nameOk}>
        {copying.state === "copied" ? <Check className="size-4" /> : <Swords className="size-4" />} {copying.state === "copied" ? "Copied" : "Challenge a friend"}
      </button>
      {copying.state === "failed" && (
        <label className="run-panel-note run-challenge-fallback">
          Couldn't copy. Send this link:
          <Input readOnly value={copying.link} onFocus={(event) => event.target.select()} aria-label="Challenge link" />
        </label>
      )}
    </form>
  );
}

function CopyLink({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const reset = useResetTimer();
  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    reset(() => setCopied(false));
  }
  return (
    <button type="button" className="hud-button run-panel-link" onClick={() => void copy()}>
      {copied ? <Check className="size-4" /> : <Link2 className="size-4" />} {copied ? "Copied" : label}
    </button>
  );
}

/** Runs a reset COPIED_FOR after the last call; a second copy restarts it, and leaving the end screen cancels it. */
function useResetTimer(): (reset: () => void) => void {
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (reset) => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(reset, COPIED_FOR);
  };
}
