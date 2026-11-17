import { useState } from "react";
import { Palette } from "lucide-react";
import { CharacterSheet } from "@/components/compose/character-sheet";
import { Help } from "@/components/compose/controls";
import { choicesFor, pickFor, type Choices } from "@/lib/choices";
import { defaultCharacter } from "../../../server/character";
import { validLogin } from "@/lib/published-list";
import { fetchPlayer, type Player } from "@/lib/run";

const ACE_HINT = "Free card in round 1";
const DECK_HINT = "Up to half your shop comes from this List";
const WAIT = [{ value: "", label: "Reading your stars..." }];

type Reading = { state: "idle" } | { state: "reading" } | { state: "failed"; message: string };

/**
 * Customize your team: the character's class and look, the ace, and the deck, for the next
 * run and its team link. Kept in this browser (src/lib/choices.ts); a name and a motto stay
 * with the player's GitHub (worker/src/team.ts says why). The end of a run hands over the
 * player it dealt; the Play screen has only a typed login, so the sheet opens at once on the
 * login's default look and reads the player's cards behind it (the same read Play then reuses,
 * src/lib/run.ts). A saved look replaces the default when it lands, unless the player changed it.
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
    setOpen(true);
    if (shown) return;
    setReading({ state: "reading" });
    try {
      setRead(await fetchPlayer(login));
      setReading({ state: "idle" });
    } catch (cause) {
      setReading({ state: "failed", message: cause instanceof Error ? cause.message : "The cards couldn't be read." });
    }
  }

  const base = shown?.character ?? defaultCharacter(login);
  const character = { ...base, ...(picked.klass ? { klass: picked.klass } : {}), ...(picked.look ? { look: picked.look } : {}) };
  const aces = shown?.aces ?? [];
  const decks = shown?.decks ?? [];
  return (
    <>
      <button type="button" className="hud-button run-panel-link" disabled={!validLogin(login)} onClick={() => void openSheet()}>
        <Palette className="size-4" /> Customize your team
      </button>
      {validLogin(login) && (
        <CharacterSheet
          open={open}
          onOpenChange={setOpen}
          login={shown?.login ?? login}
          character={character}
          onChange={(next) => pick({ klass: next.klass, look: next.look })}
          words={false}
          title="Customize your team"
          description="For your next run"
        >
          <div className="space-y-4">
            {reading.state === "failed" && !shown ? (
              <p className="text-sm text-[#ff8f93]" role="alert">{reading.message}</p>
            ) : (
              <>
                <PickRow label="Ace" hint={ACE_HINT} value={picked.ace ?? ""} onPick={(ace) => pick({ ace: ace || undefined })} options={shown ? [{ value: "", label: "Your profile's pick" }, ...aces.map((name) => ({ value: name, label: name }))] : WAIT} disabled={aces.length < 2} />
                {shown && decks.length === 0 ? (
                  <PickRow label="Deck" hint={DECK_HINT}>
                    <p className="flex h-9 items-center text-sm text-muted-foreground">
                      No Lists yet ·&nbsp;
                      <a className="underline underline-offset-4" href={`https://github.com/${shown.login}?tab=stars`} target="_blank" rel="noopener noreferrer">Make one on GitHub</a>
                    </p>
                  </PickRow>
                ) : (
                  <PickRow label="Deck" hint={DECK_HINT} value={picked.deck ?? ""} onPick={(deck) => pick({ deck: deck || undefined })} options={shown ? [{ value: "", label: "All stars" }, ...decks.map((deck) => ({ value: deck.slug, label: deck.name }))] : WAIT} disabled={!shown} />
                )}
              </>
            )}
          </div>
        </CharacterSheet>
      )}
    </>
  );
}

// One choice under its label. Every state keeps the same height, so the class list below never moves while the stars are read.
function PickRow({ label, hint, value = "", options = [], onPick, disabled, children }: { label: string; hint: string; value?: string; options?: { value: string; label: string }[]; onPick?: (value: string) => void; disabled?: boolean; children?: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1">
        <label htmlFor={`pick-${label}`} className="text-sm font-medium">{label}</label>
        <Help label={`About ${label.toLowerCase()}`}>{hint}</Help>
      </div>
      {children ?? (
        <select id={`pick-${label}`} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} disabled={disabled} onChange={(event) => onPick?.(event.target.value)}>
          {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      )}
    </div>
  );
}
