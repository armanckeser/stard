import { useState } from "react";
import { Palette } from "lucide-react";
import { CharacterSheet } from "@/components/compose/character-sheet";
import { Help } from "@/components/compose/controls";
import { choicesFor, pickFor, type Choices } from "@/lib/choices";
import { validLogin } from "@/lib/published-list";
import { fetchPlayer, type Player } from "@/lib/run";

type Reading = { state: "idle" } | { state: "reading" } | { state: "failed"; message: string };

/**
 * Customize your team: the character's class and look, the ace, and the deck, for the next
 * run and its team link. Kept in this browser (src/lib/choices.ts); a name and a motto stay
 * with the player's GitHub (worker/src/team.ts says why). The end of a run hands over the
 * player it dealt; the Play screen has only a typed login, so the sheet reads the player's
 * cards when it opens (the same read Play then reuses, src/lib/run.ts).
 */
export function Customize({ login, player }: { login: string; player?: Player }) {
  const [open, setOpen] = useState(false);
  const [read, setRead] = useState<Player | null>(null);
  const [reading, setReading] = useState<Reading>({ state: "idle" });
  const [picked, setPicked] = useState<Choices>({});
  const shown = player ?? (read && read.login.toLowerCase() === login.toLowerCase() ? read : null);
  // A new deck or ace deals different cards: reading them now means Play starts without a second wait.
  const pick = (change: Choices) => {
    const next = pickFor(login, change);
    setPicked(next);
    if ("deck" in change || "ace" in change) void fetchPlayer(login, undefined, { deck: next.deck, ace: next.ace }).catch(() => {});
  };

  async function openSheet() {
    setPicked(choicesFor(login));
    if (shown) return setOpen(true);
    setReading({ state: "reading" });
    try {
      setRead(await fetchPlayer(login));
      setReading({ state: "idle" });
      setOpen(true);
    } catch (cause) {
      setReading({ state: "failed", message: cause instanceof Error ? cause.message : "The cards couldn't be read." });
    }
  }

  const character = shown && { ...shown.character, ...(picked.klass ? { klass: picked.klass } : {}), ...(picked.look ? { look: picked.look } : {}) };
  const aces = shown?.aces ?? [];
  const decks = shown?.decks ?? [];
  return (
    <>
      <button type="button" className="hud-button run-panel-link" disabled={!validLogin(login) || reading.state === "reading"} onClick={() => void openSheet()}>
        <Palette className="size-4" /> {reading.state === "reading" ? "Reading your stars..." : "Customize your team"}
      </button>
      {reading.state === "failed" && <p className="run-panel-note" role="alert">{reading.message}</p>}
      {shown && character && (
        <CharacterSheet
          open={open}
          onOpenChange={setOpen}
          login={shown.login}
          character={character}
          onChange={(next) => pick({ klass: next.klass, look: next.look })}
          words={false}
          title="Customize your team"
          description="For your next run"
        >
          <div className="space-y-4">
            {aces.length > 1 && (
              <PickRow label="Ace" hint="Free card in round 1" value={picked.ace ?? ""} onPick={(ace) => pick({ ace: ace || undefined })} options={[{ value: "", label: "Your profile's pick" }, ...aces.map((name) => ({ value: name, label: name }))]} />
            )}
            {decks.length > 0 ? (
              <PickRow label="Deck" hint="Up to half your shop comes from this List" value={picked.deck ?? ""} onPick={(deck) => pick({ deck: deck || undefined })} options={[{ value: "", label: "All stars" }, ...decks.map((deck) => ({ value: deck.slug, label: deck.name }))]} />
            ) : (
              <p className="text-sm text-muted-foreground">
                No Lists yet ·{" "}
                <a className="underline underline-offset-4" href={`https://github.com/${shown.login}?tab=stars`} target="_blank" rel="noopener noreferrer">Make one on GitHub</a>
              </p>
            )}
          </div>
        </CharacterSheet>
      )}
    </>
  );
}

function PickRow({ label, hint, value, options, onPick }: { label: string; hint: string; value: string; options: { value: string; label: string }[]; onPick: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={`pick-${label}`} className="text-sm font-medium">{label}</label>
        <Help label={`About ${label.toLowerCase()}`}>{hint}</Help>
      </div>
      <select id={`pick-${label}`} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(event) => onPick(event.target.value)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}
