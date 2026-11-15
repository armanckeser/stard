import { useEffect, useRef, useState } from "react";
import { Check, Link2, Palette, RotateCcw, Swords } from "lucide-react";
import { StarStard } from "@/components/star-stard";
import { TeamTiles } from "@/components/run/team-tiles";
import { Input } from "@/components/ui/input";
import { beatLine, beatenIn, challengeLink, challengeMessage, type RoundResult } from "@/lib/challenge";
import { CharacterSheet } from "@/components/compose/character-sheet";
import { choicesFor, pickFor, type Choices } from "@/lib/choices";
import { countEvent } from "@/lib/events";
import { APP_URL, validLogin } from "@/lib/published-list";
import { WINS_TO_FINISH, type Player, type Unit } from "@/lib/run";
import { recordOf, saveTeam, teamLink } from "@/lib/saved-team";
import type { Snapshot } from "../../../server/run/types";

// The end of a run, over the dimmed board (docs/GAME-UI.md §1, §2): one slate panel
// with the gold line on its edge, who the run beat, the record, the team as shop cards,
// Challenge a friend as the only filled button, and the rest quiet under it.

type Saving = { state: "saving" } | { state: "saved"; link: string } | { state: "failed"; message: string };

// How long "Copied" shows before the button reads as itself again.
const COPIED_FOR = 1500;

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
  useEffect(() => {
    let live = true;
    setSaving({ state: "saving" });
    saveTeam(player, seed, rounds, against)
      .then(({ token }) => live && setSaving({ state: "saved", link: teamLink(token) }))
      .catch((cause: unknown) => live && setSaving({ state: "failed", message: cause instanceof Error && cause.message !== "Failed to fetch" ? cause.message : "The team couldn't be saved." }));
    return () => {
      live = false;
    };
  }, [player, seed, rounds, against]);
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
        {saving.state === "failed" ? <CopyLink text={`${APP_URL}run`} label="Copy Play link" /> : <Customize player={player} />}
        {saving.state !== "failed" && newRun}
        <StarStard className="text-white/55 hover:text-white" />
      </div>
      {saving.state === "failed" && <p className="run-panel-note text-center" role="alert">{saving.message} The link opens the Play screen instead.</p>}
    </section>
  );
}

/**
 * Customize your team: the character's class and look, the ace, and the deck, for the next
 * run and its team link. Kept in this browser (src/lib/choices.ts); a name and a motto stay
 * with the player's GitHub (worker/src/team.ts says why).
 */
function Customize({ player }: { player: Player }) {
  const { login } = player;
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState(() => choicesFor(login));
  const pick = (change: Choices) => setPicked(pickFor(login, change));
  const character = { ...player.character, ...(picked.klass ? { klass: picked.klass } : {}), ...(picked.look ? { look: picked.look } : {}) };
  const aces = player.aces ?? [];
  const decks = player.decks ?? [];
  return (
    <>
      <button type="button" className="hud-button run-panel-link" onClick={() => setOpen(true)}><Palette className="size-4" /> Customize your team</button>
      <CharacterSheet
        open={open}
        onOpenChange={setOpen}
        login={login}
        character={character}
        onChange={(next) => pick({ klass: next.klass, look: next.look })}
        words={false}
        title="Customize your team"
        description="Your next run is dealt with these, and its team link shows them. They're kept in this browser."
      >
        <div className="space-y-4">
          {aces.length > 1 && (
            <PickRow label="Ace" hint="Your free card in round 1, from your profile, pins and own repos." value={picked.ace ?? ""} onPick={(ace) => pick({ ace: ace || undefined })} options={[{ value: "", label: "Your profile's pick" }, ...aces.map((name) => ({ value: name, label: name }))]} />
          )}
          {decks.length > 0 ? (
            <PickRow label="Deck" hint="A List of your stars deals up to half your shop." value={picked.deck ?? ""} onPick={(deck) => pick({ deck: deck || undefined })} options={[{ value: "", label: "All stars" }, ...decks.map((deck) => ({ value: deck.slug, label: deck.name }))]} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Make a public List of your stars on GitHub, and it becomes a deck here.{" "}
              <a className="underline underline-offset-4" href={`https://github.com/${login}?tab=stars`} target="_blank" rel="noopener noreferrer">Your stars</a>
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            For your README card and anyone who challenges you by name, put your character in a <code>stard</code> repo: <code>npx github-stars-organizer</code> opens Stard with your own GitHub login.
          </p>
        </div>
      </CharacterSheet>
    </>
  );
}

function PickRow({ label, hint, value, options, onPick }: { label: string; hint: string; value: string; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-sm font-medium">{label}</span>
      <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(event) => onPick(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <span className="block text-xs text-muted-foreground">{hint}</span>
    </label>
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
