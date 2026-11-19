import { createFileRoute, Link } from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, CircleHelp, Coins, Crosshair, Hand, RotateCw, Layers, Maximize, Minimize, Shield, SkipForward, Star, Swords, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InspectOverlay } from "@/components/battle/arena";
import { FightClock } from "@/components/battle/fight-clock";
import { FightInspect } from "@/components/battle/fight-inspect";
import { Figure } from "@/components/battle/figure";
import { OpponentsLink } from "@/components/battle/opponents-link";
import { RunStart } from "@/components/battle/run-start";
import { NotAffiliated } from "@/components/not-affiliated";
import type { BoardUnit } from "@/components/battle/three/board";
import { FpsMeter } from "@/components/run/fps-meter";
import { TeamSlots } from "@/components/run/team-slots";
import { BarButton } from "@/components/run/bar-button";
import { BoostPick, prepareBoostPick } from "@/components/run/boost-pick";
import { RunCard } from "@/components/run/run-card";
import { Checks } from "@/components/run/checks";
import { useMediaQuery } from "@/hooks/use-media-query";
import { RunEnd } from "@/components/run/run-end";
import { Shop } from "@/components/run/shop";
import { demoUser } from "@/lib/demo";
import { readNextRound, readRun } from "@/lib/run-reads";
import { countEvent } from "@/lib/events";
import { validLogin } from "@/lib/published-list";
import { playLevel } from "@/lib/level";
import { LOSSES_TO_END, NEW_TALLY, REROLL_COST, ROUND_GOLD, WINS_TO_FINISH, WIN_GOLD, costOf, newRunSeed, rangeOf, type Player, type RunFighter, type Unit } from "@/lib/run";
import { NO_RUN, idOf, offerAt, runReducer, sceneOf, type Fought } from "@/lib/run-state";
import { BOOST_ROUNDS } from "../../server/run/boosts";
import { CLASSES } from "../../server/character";
import { cardsOf, emptyBench, type Roster } from "../../server/run/roster";
import { boardLimit } from "../../server/run/rules";
import { cellOf, type Side } from "../../server/run/types";

// The Play screen: a run, played on one board. The player buys cards from the shop
// along the bottom, drags them around their half, and presses Fight; every creature
// then fights at once. Five wins or three losses ends the run.

export const Route = createFileRoute("/run")({
  component: RunPage,
  validateSearch: (search: Record<string, unknown>): { me?: string; against?: string; name?: string } => ({
    me: typeof search.me === "string" ? search.me : undefined,
    // A finished run's team from its share link (/team): every round is played against that team.
    against: typeof search.against === "string" ? search.against : undefined,
    // The friend a challenge named (/team?to=). It only fills in the form: whoever opened the link may be someone else.
    name: typeof search.name === "string" && validLogin(search.name) ? search.name.trim() : undefined,
  }),
});

const Board3D = lazy(() => import("@/components/battle/board3d"));
/** The shop's tab, which stays on screen when the shop folds down. */
const SHOP_TAB = 34;
const PANEL = "rounded-lg border border-white/15 bg-[#0c1014]/90 shadow-lg backdrop-blur-sm";

// The board before a run has one: one array each, so the board's memo holds between renders.
const NO_UNITS: Unit[] = [];
const NO_BENCH: (RunFighter | null)[] = emptyBench();
const NO_BOOSTS: string[] = [];

function Pips({ filled, total, tone, label }: { filled: number; total: number; tone: string; label: string }) {
  return (
    <span className="flex items-center gap-1" aria-label={`${filled} of ${total} ${label}`}>
      {Array.from({ length: total }, (_, i) => <span key={i} className={`size-2.5 rounded-full ${i < filled ? tone : "bg-white/15"}`} />)}
    </span>
  );
}

/** The wins and losses as words, for the pips' hover and the player's own profile. */
const tallyLine = (wins: number, losses: number) => `Wins ${wins}/${WINS_TO_FINISH} · Losses ${losses}/${LOSSES_TO_END}`;

// How long a player sits without touching anything in round 1 before the ? lights up, and for how long.
const IDLE_MS = 10_000;
const NUDGE_MS = 4_000;

/**
 * True for a few seconds once the player has done nothing for IDLE_MS while `watching`:
 * most players jump straight in, so How to play never opens by itself; the ? glows
 * for whoever looks stuck. At most once per page load.
 */
function useIdleNudge(watching: boolean): boolean {
  const [on, setOn] = useState(false);
  const done = useRef(false);
  useEffect(() => {
    if (!watching || done.current) return;
    let off: number | undefined;
    let idle = window.setTimeout(fire, IDLE_MS);
    function fire() {
      done.current = true;
      setOn(true);
      off = window.setTimeout(() => setOn(false), NUDGE_MS);
      stop();
    }
    function reset() {
      window.clearTimeout(idle);
      idle = window.setTimeout(fire, IDLE_MS);
    }
    const events = ["pointerdown", "keydown", "wheel"] as const;
    function stop() {
      window.clearTimeout(idle);
      for (const name of events) window.removeEventListener(name, reset);
    }
    for (const name of events) window.addEventListener(name, reset);
    return () => {
      stop();
      window.clearTimeout(off);
      setOn(false);
    };
  }, [watching]);
  return on;
}

/** The HUD's ?, which lights up for a player who sits still while `watching`. */
function HelpButton({ open, onToggle, watching }: { open: boolean; onToggle: () => void; watching: boolean }) {
  const nudge = useIdleNudge(watching && !open);
  return (
    <button type="button" onClick={onToggle} aria-label="How to play" aria-expanded={open} data-nudge={nudge ? "" : undefined} className="hud-chip help-nudge p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CircleHelp className="size-4" />
    </button>
  );
}

/** The height of an element as it resizes, through a callback ref; 0 once it is gone. */
function useHeight(): [number, (element: HTMLElement | null) => void] {
  const [height, setHeight] = useState(0);
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return setHeight(0);
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    setHeight(element.offsetHeight);
  }, []);
  return [height, ref];
}

/** The arena on the whole screen, where the browser allows it, turned wide on a phone that can lock its turn (Android; an iPhone can do neither). */
function useFullscreen(): [boolean, ((element: HTMLElement | null) => void), (() => void) | null] {
  const [element, setElement] = useState<HTMLElement | null>(null);
  const [full, setFull] = useState(false);
  useEffect(() => {
    const changed = () => setFull(document.fullscreenElement !== null && document.fullscreenElement === element);
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, [element]);
  const able = typeof document !== "undefined" && document.fullscreenEnabled && element !== null;
  const toggle = async () => {
    if (!element) return;
    if (document.fullscreenElement) return document.exitFullscreen();
    await element.requestFullscreen({ navigationUI: "hide" });
    // A desktop browser has no turn to lock and refuses; the arena is full screen either way.
    await (screen.orientation as ScreenOrientation & { lock?: (orientation: "landscape") => Promise<void> }).lock?.("landscape").catch(() => undefined);
  };
  return [full, setElement, able ? () => void toggle() : null];
}

function RunPage() {
  const search = Route.useSearch();
  const [login, setLogin] = useState(search.me ?? search.name ?? demoUser.current ?? "");
  const [state, dispatch] = useReducer(runReducer, NO_RUN);
  const { phase, seed, selected, viewing } = state;
  const { player, run, round, fight } = sceneOf(phase);
  const units = run?.units ?? NO_UNITS;
  const bench = run?.bench ?? NO_BENCH;
  const boosts = run?.boosts ?? NO_BOOSTS;
  const { wins, losses } = run?.tally ?? NEW_TALLY;
  const tally = tallyLine(wins, losses);
  const gold = run?.gold ?? 0;

  const [fast, setFast] = useState(false);
  const [skips, setSkips] = useState(0);
  const [profile, setProfile] = useState<Player | null>(null);
  const [help, setHelp] = useState(false);
  // A phone folds its own checks too: a full list covers the board (docs/GAME-UI.md §7).
  const phone = useMediaQuery("(max-width: 639px), (max-height: 540px)");

  const start = (who: string) => {
    if (validLogin(who)) dispatch({ type: "start", seed: newRunSeed(playLevel()), login: who.trim() });
  };

  // A link with ?me= starts the run on load, so opening the link is all it takes. StrictMode
  // runs this twice in development: the second start's seed wins and the first one's read is dropped.
  const linked = search.me && validLogin(search.me) ? search.me.trim() : null;
  useEffect(() => {
    if (linked) start(linked);
    // Once, for the address the page was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape folds the help away, as it closes an open card.
  useEffect(() => {
    if (!help) return;
    const fold = (event: KeyboardEvent) => event.key === "Escape" && setHelp(false);
    window.addEventListener("keydown", fold);
    return () => window.removeEventListener("keydown", fold);
  }, [help]);

  // Each loading phase reads what it waits for; the answer names its run's seed, so a newer run drops it.
  const loadingRun = phase.kind === "loading-run" ? phase : null;
  useEffect(() => {
    if (loadingRun) void readRun(loadingRun.login, seed, search.against).then(dispatch);
  }, [loadingRun, seed, search.against]);
  const loadingRound = phase.kind === "loading-round" ? phase : null;
  useEffect(() => {
    if (loadingRound) void readNextRound(loadingRound.run, loadingRound.number, seed).then(dispatch);
  }, [loadingRound, seed]);

  // A boost round's medallions are drawn while its result shows, not during the fight, so
  // the pick opens with all three and the fight keeps its frames.
  const resultShown = phase.kind === "round-result" ? phase : null;
  useEffect(() => {
    if (resultShown && (BOOST_ROUNDS as readonly number[]).includes(resultShown.round.number)) prepareBoostPick(offerAt(resultShown.run, resultShown.round.number, seed).ids);
  }, [resultShown, seed]);

  // The counters (server/events.ts): a round counts once it opens, a run once it ends.
  const openedRound = phase.kind === "shop" || phase.kind === "boost-pick" ? phase.round.number : null;
  useEffect(() => {
    if (openedRound === null) return;
    if (openedRound === 1) countEvent("run_started");
    if (openedRound === 1 && search.against) countEvent("challenge_started");
    countEvent("round_reached", openedRound);
  }, [seed, openedRound, search.against]);
  const endedRound = phase.kind === "end" ? phase.round.number : null;
  useEffect(() => {
    if (endedRound !== null) countEvent("run_finished", endedRound);
  }, [seed, endedRound]);

  const [drawer, drawerRef] = useHeight();
  // The shop rises at the start of each round and folds down to its tab when the player wants the board.
  const [shopOpen, setShopOpen] = useState(true);
  useEffect(() => setShopOpen(true), [round?.number]);
  const [full, arenaRef, toggleFull] = useFullscreen();
  // For screenshots of the boost pick: `stardOffer(2)` in the console, development builds only.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as { stardOffer?: (round: number) => void }).stardOffer = (number) => dispatch({ type: "offer", round: number });
  }, []);

  const building = phase.kind === "shop" || phase.kind === "boost-pick" ? phase : null;
  // The boost pick covers the shop until the player folds it away to look at the board.
  const shopUsable = building !== null && (building.kind === "shop" || building.peeking);
  const shopShown = shopOpen && shopUsable;
  const cap = round && run ? boardLimit(round.number, run.bought) : 0;
  const roster: Roster = { board: units, bench };
  const fighting = phase.kind === "fighting";
  // Stable, because the creature panel restarts its close-after-fainting timer when this changes.
  const look = useCallback((id: string | null) => dispatch({ type: "look", id }), []);
  // The tick the board's fight has reached, for the creature panel beside it (fight-inspect.tsx).
  const [clock] = useState(() => new FightClock());
  const [covered, setCovered] = useState(0);
  const fightTeams = useMemo<[RunFighter[], RunFighter[]]>(() => [units.map((unit) => unit.fighter), (round?.theirs ?? []).map((unit) => unit.fighter)], [units, round]);
  const viewingTeam = viewing?.kind === "theirs" ? (round?.theirs ?? []) : units;
  const close = () => dispatch({ type: "close" });

  const boardUnits = useMemo<BoardUnit[]>(() => {
    const side = (which: Side, team: Unit[]) => team.map((unit) => ({ id: idOf(which, unit.fighter), side: which, fighter: unit.fighter, ...cellOf(which, unit), ranged: rangeOf(unit.fighter) > 1 }));
    const drafts = bench.flatMap((fighter, slot) => (fighter ? [{ id: idOf(0, fighter), side: 0 as Side, fighter, x: 0, y: 0, ranged: rangeOf(fighter) > 1, bench: slot }] : []));
    return [...side(0, units), ...drafts, ...side(1, round?.theirs ?? [])];
  }, [units, bench, round]);
  // Round 1 with the shop up: a player who sits still here gets the ? lit up.

  return (
    <div ref={arenaRef} data-full={full ? "" : undefined} className="arena relative h-dvh w-full overflow-hidden bg-[#080b0f] text-white">
      <Suspense fallback={null}>
        <Board3D
          units={boardUnits}
          near={player ? { look: player.character.look, supporter: player.supporter === true } : null}
          far={round ? { look: round.opponent.character.look, supporter: round.opponent.supporter === true } : null}
          selected={selected}
          fight={fight}
          clock={clock}
          speed={fast ? 2 : 1}
          skips={skips}
          room={Math.max(0, cap - units.length)}
          inset={building ? SHOP_TAB + (shopShown ? drawer : 0) : fighting ? covered : 0}
          onSelect={look}
          onFightEnd={(key) => dispatch({ type: "fight-ended", key })}
          onMove={(id, spot) => dispatch({ type: "move", id, spot })}
          sellPrice={(id) => {
            const fighter = cardsOf(roster).find((card) => idOf(0, card) === id);
            return fighter ? costOf(fighter) : null;
          }}
          onDrag={() => {}}
        />
      </Suspense>

      <Link to="/" aria-label="Leave Play" className="hud-chip play-exit absolute left-2 top-2 z-30 grid size-9 place-items-center outline-none focus-visible:ring-2 focus-visible:ring-ring sm:left-3 sm:top-3">
        <ArrowLeft className="size-4" />
      </Link>
      {player && round && (
        <div className="hud-top pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-2 p-2 pl-13 sm:p-3 sm:pl-15">
          <button type="button" onClick={() => setProfile(player)} aria-label={`About ${player.login}`} className={`hud-chip pointer-events-auto flex items-center gap-2 px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
            {player.avatarUrl && <img src={player.avatarUrl} alt="" className="size-6 rounded-full" />}
            <span className="block space-y-1" title={tally}>
              <Pips filled={wins} total={WINS_TO_FINISH} tone="bg-primary" label="wins" />
              <Pips filled={losses} total={LOSSES_TO_END} tone="bg-[#e5484d]" label="losses" />
            </span>
          </button>
          <p className={`hud-chip whitespace-nowrap px-3 py-1.5 font-display text-base font-bold tracking-tight sm:text-xl`}>Round {round.number}</p>
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button type="button" onClick={() => setProfile(round.opponent)} aria-label={`About ${round.opponent.login}`} className={`hud-chip flex items-center gap-2 px-2.5 py-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring`}>
              <span className="hidden max-w-40 truncate text-sm font-medium sm:block">@{round.opponent.login}</span>
              {round.opponent.avatarUrl && <img src={round.opponent.avatarUrl} alt="" className="size-6 rounded-full" />}
            </button>
            {toggleFull && <button type="button" onClick={toggleFull} aria-label={full ? "Leave full screen" : "Full screen"} className="hud-chip p-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">{full ? <Minimize className="size-4" /> : <Maximize className="size-4" />}</button>}
            <HelpButton open={help} onToggle={() => setHelp(!help)} watching={phase.kind === "shop" && round.number === 1} />
          </div>
        </div>
      )}

      {player && round && (
        <div className="checks-rail pointer-events-none absolute inset-x-0 top-14 z-10 flex items-start justify-between gap-2 px-1 sm:top-20 sm:px-2">
          <Checks title="Checks" cards={units.map((unit) => unit.fighter.card)} boosts={boosts} folds={phone} pulse={phase.kind !== "shop"} />
          <Checks title={round.opponent.login} cards={round.theirs.map((unit) => unit.fighter.card)} boosts={round.theirBoosts} align="right" folds pulse={phase.kind !== "shop"} />
        </div>
      )}

      {phase.kind === "boost-pick" && <BoostPick offer={phase.offer.ids} first={units[0]?.fighter.fullName} peeking={phase.peeking} onPeek={(peeking) => dispatch({ type: "peek", peeking })} onPick={(id) => dispatch({ type: "pick", id })} />}

      {!player && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-black/45 p-4">
          <RunStart login={login} onLogin={setLogin} onStart={start} loading={phase.kind === "loading-run"} error={phase.kind === "failed" ? phase.message : ""} starting={linked} className={`${PANEL} w-full max-w-sm p-5`} />
          <NotAffiliated />
        </div>
      )}

      {player && phase.kind === "loading-run" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <p className={`${PANEL} px-4 py-3 text-sm`} role="status">Dealing a new run...</p>
        </div>
      )}

      {player && phase.kind === "failed" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center p-4">
          <div className={`${PANEL} w-full max-w-sm space-y-3 p-4 text-sm`}>
            <p role="alert">{phase.message}</p>
            <Button className="w-full" onClick={() => (phase.retry.kind === "run" ? start(phase.retry.login) : dispatch({ type: "retry-round" }))}><RotateCw /> Try again</Button>
          </div>
        </div>
      )}

      {building && (
        <>
          <div className="shop-dock absolute inset-x-0 bottom-0 z-10" data-open={shopShown ? "" : undefined} style={{ "--drawer": `${drawer}px` } as React.CSSProperties}>
            {/* The gold plaque on the bar's top edge, as TFT keeps the gold over the shop's middle; the shop folds down under it. */}
            <button type="button" className="shop-plaque" onClick={() => setShopOpen(!shopShown)} aria-expanded={shopShown} aria-controls="shop-drawer" aria-label={shopShown ? "Fold the shop" : "Open the shop"}>
              <span className="hud-coin" />
              <span className="shop-plaque-gold" aria-label={`${gold} gold`}>{gold}</span>
              {shopShown ? <ChevronDown className="size-3.5 text-white/45" /> : <ChevronUp className="size-3.5 text-white/45" />}
            </button>
            <div ref={drawerRef} id="shop-drawer" className="shop-bar" inert={!shopShown}>
              <div className="shop-layout">
                <div className="shop-controls">
                  <BarButton label="Reroll" cost={REROLL_COST} icon={<RotateCw className="size-4" strokeWidth={2.6} />} disabled={gold < REROLL_COST} onClick={() => dispatch({ type: "reroll" })} aria-label={`Reroll for ${REROLL_COST} gold`} />
                  <TeamSlots count={units.length} limit={cap} gold={gold} onBuy={() => dispatch({ type: "buy-slot" })} />
                </div>
                <div className="shop-cards"><Shop shop={building.shelf.cards} held={cardsOf(roster)} gold={gold} draftsFull={!bench.includes(null) && units.length >= cap} onOpen={(slot) => dispatch({ type: "look-shop", slot })} /></div>
              </div>
            </div>
          </div>
          {/* Fight: the only filled button, in the bar's corner, and in the screen's corner when the bar folds. A boost is picked before the fight. */}
          <button type="button" className="shop-fight hud-fight" data-open={shopShown ? "" : undefined} style={{ "--drawer": `${drawer}px` } as React.CSSProperties} onClick={() => dispatch({ type: "fight" })} disabled={building.kind !== "shop" || units.length === 0}><Swords className="size-5" /> Fight</button>
        </>
      )}

      {fighting && fight && round && <FightInspect fight={fight} teams={fightTeams} opponent={round.opponent.login} clock={clock} selected={selected} onSelect={look} onCover={setCovered} />}
      {fighting && (
        <div className="absolute bottom-3 right-3 z-10 flex gap-1.5">
          <Button variant="outline" size="sm" aria-pressed={fast} onClick={() => setFast((f) => !f)}>{fast ? "2×" : "1×"}</Button>
          <Button variant="outline" size="sm" onClick={() => setSkips((count) => count + 1)}><SkipForward /> Skip</Button>
        </div>
      )}

      {(phase.kind === "round-result" || phase.kind === "loading-round") && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 border-t border-white/15 bg-[#0c1014]/90 px-4 py-4 backdrop-blur-sm">
          <div aria-live="polite">
            <p className="font-display text-lg font-bold tracking-tight sm:text-2xl">{resultLine(phase.kind === "round-result" ? phase : phase.after)}</p>
            {phase.kind === "round-result" && phase.winner === 1 && units.length < cap && (
              <p className="text-sm text-white/70">{cap - units.length} empty {cap - units.length === 1 ? "spot" : "spots"}</p>
            )}
          </div>
          {phase.kind === "round-result" ? <Button onClick={() => dispatch({ type: "continue" })}>Continue</Button> : <Button disabled>Reading the next team...</Button>}
        </div>
      )}

      {phase.kind === "end" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 p-4">
          <RunEnd player={phase.run.player} seed={seed} rounds={phase.run.history} results={phase.run.results} team={phase.run.units} wins={wins} losses={losses} against={phase.run.against ? search.against : undefined} onNewRun={() => start(phase.run.player.login)} />
        </div>
      )}

      {help && (
        <div className={`${PANEL} absolute right-2 top-14 z-30 w-72 space-y-2 p-3 text-sm sm:right-3`}>
          <div className="flex items-center justify-between">
            <p className="font-display font-bold tracking-tight">How to play</p>
            <button type="button" onClick={() => setHelp(false)} aria-label="Close" className="rounded p-1 outline-none focus-visible:ring-2 focus-visible:ring-ring"><X className="size-4" /></button>
          </div>
          <ul className="space-y-1.5 text-white/80">
            <li className="flex gap-2"><Coins className="mt-0.5 size-4 shrink-0 text-[#ffd84d]" /> Tap a card to buy. {ROUND_GOLD} gold a round, +{WIN_GOLD} for a win.</li>
            <li className="flex gap-2"><Shield className="mt-0.5 size-4 shrink-0" /> Front row: Tanks, Bruisers, Assassins.</li>
            <li className="flex gap-2"><Crosshair className="mt-0.5 size-4 shrink-0" /> Back row: Ranged.</li>
            <li className="flex gap-2"><Hand className="mt-0.5 size-4 shrink-0" /> Drag to move. Drop on the Archive to sell.</li>
            <li className="flex gap-2"><Layers className="mt-0.5 size-4 shrink-0 text-[#35c450]" /> Cards of the same language or topic give a set bonus.</li>
            <li className="flex gap-2"><Star className="mt-0.5 size-4 shrink-0" /> Win {WINS_TO_FINISH} before you lose {LOSSES_TO_END}.</li>
            <li className="flex gap-2"><Users className="mt-0.5 size-4 shrink-0" /> <OpponentsLink /></li>
          </ul>
          <NotAffiliated />
        </div>
      )}

      {profile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6" role="dialog" aria-modal="true" aria-label={profile.login} onClick={() => setProfile(null)}>
          <div className={`${PANEL} battle-deal w-full max-w-xs space-y-3 p-4 text-center`} onClick={(e) => e.stopPropagation()}>
            <div className="mx-auto w-fit rounded-md" style={{ background: CLASSES[profile.character.klass].color }}><Figure look={profile.character.look} supporter={profile.supporter === true} className="h-40 w-auto" /></div>
            <div>
              <p className="font-display text-xl font-bold tracking-tight">{profile.character.name}</p>
              <p className="text-sm">{CLASSES[profile.character.klass].label} · Lv {profile.character.level}</p>
              {profile === player && <p className="text-sm text-white/80">{tally}</p>}
              {profile.supporter && <p className="text-xs text-white/70">Starred Stard</p>}
              {profile.character.klass !== "rookie" && <p className="text-xs text-white/70">{CLASSES[profile.character.klass].perk}</p>}
              {profile.character.motto && <p className="mt-1 text-xs text-white/70">“{profile.character.motto}”</p>}
            </div>
            <div className="flex items-center justify-between gap-2 text-sm">
              <a href={`https://github.com/${profile.login}`} target="_blank" rel="noopener noreferrer" className="truncate underline-offset-4 hover:underline">@{profile.login}</a>
              <Button variant="outline" size="sm" onClick={() => setProfile(null)}><X /> Close</Button>
            </div>
          </div>
        </div>
      )}

      <FpsMeter />

      <InspectOverlay fighter={viewing?.fighter ?? null} onClose={close} card={viewing && <RunCard fighter={viewing.fighter} team={viewingTeam.map((unit) => unit.fighter)} />}>
        {viewing?.kind === "shop" && shopUsable && (
          <Button className="w-full" disabled={gold < costOf(viewing.fighter) || (!bench.includes(null) && units.length >= cap)} onClick={() => { dispatch({ type: "buy", slot: viewing.slot }); close(); }}>
            <Coins /> {!bench.includes(null) && units.length >= cap ? "Board and Drafts are full" : gold < costOf(viewing.fighter) ? `Costs ${costOf(viewing.fighter)}, you have ${gold}` : `Buy for ${costOf(viewing.fighter)}`}
          </Button>
        )}
        {(viewing?.kind === "board" || viewing?.kind === "drafts") && shopUsable && <Button variant="outline" className="w-full" onClick={() => dispatch({ type: "sell", id: idOf(0, viewing.fighter) })}><Coins /> Sell for {costOf(viewing.fighter)}</Button>}
      </InspectOverlay>
    </div>
  );
}

/** The result bar's line for a round just played; the next round's number when there is none (a retried read). */
function resultLine(fought: Fought | null): string {
  if (!fought) return "Next round";
  if (fought.winner === 0) return `Round ${fought.round.number} won`;
  if (fought.winner === 1) return `Round ${fought.round.number} lost`;
  return "A draw";
}
