import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { seededRandom, type Fighter } from "../../../../server/battle";
import type { Wearer } from "../../../../server/character";
import type { Condition } from "../../../../server/run/hooks";
import { abilityHooks } from "../../../../server/run/abilities";
import { CONDITION_NAMES, hookOf, sourceOf } from "../../../../server/run/names";
import { BENCH_SIZE } from "../../../../server/run/rules";
import { roleOf } from "../../../../server/run/stats";
import { COLS, ROWS, TICK_MS, type Card, type FightEvent, type Side } from "../../../../server/run/types";
import { ARCHIVE_DEPTH, ARCHIVE_WIDTH, buildArchive, type Archive } from "./archive";
import { buildCreature, type Creature } from "./creature";
import { playFired, SHIELD_KEY, type EffectActor, type EffectStage } from "./effects";
import { CONDITION_COLOR, EFFECT_COLOR, ISSUE_COLOR } from "./effects/stage";
import { fightLook } from "./look";
import { CONDITION_ICON, iconTexture } from "./octicons";
import { dispose, easeOut, overshoot, part, sphere, toon } from "./kit";
import { buildTrainer, type Trainer } from "./trainer";

// The board a run is played on: a 4 by 4 grid, the player's half near the camera and
// the other team's half behind. Between fights the player drags creatures around their
// half; in a fight every creature walks and hits at once, played from the fight's events.

/** A creature on the board. `x`, `y` is its board cell (server/run/types.ts); `bench` is its Drafts slot when it waits off the board. */
export type BoardUnit = { id: string; side: Side; fighter: Fighter; x: number; y: number; ranged: boolean; bench?: number };
/** Where a carried creature was put down: a cell of the player's half (row 0 in front), a Drafts slot, or the Archive. */
export type Spot = { kind: "cell"; col: number; row: number } | { kind: "bench"; slot: number } | { kind: "archive" };
export type BoardFight = { key: string; ids: [string[], string[]]; events: FightEvent[] };
/** A point on screen, in CSS pixels from the top left of the page. */
export type Point = { clientX: number; clientY: number };
/** What the renderer holds and what its last frame drew, for the perf harness (e2e/perf/). */
export type RenderInfo = { calls: number; triangles: number; geometries: number; textures: number; programs: number; objects: number; pixelRatio: number };

type Actor = {
  unit: BoardUnit;
  creature: Creature;
  /** Where the creature stands, and where it is drawn (which trails behind). */
  home: THREE.Vector3;
  at: THREE.Vector3;
  facing: number;
  hp: number;
  /** The shield the fight says it has left; drawn as a pale segment after the HP on the bar. */
  shield: number;
  bar: THREE.Group;
  fill: THREE.Mesh;
  shieldFill: THREE.Mesh;
  /** The HP a hit just took, white behind the fill: it holds a moment, then drains to the HP. `trail` is its share of the bar. */
  trailFill: THREE.Mesh;
  trail: number;
  trailHold: number;
  /** What effects keep on the creature (effects/stage.ts `attach`), by key. */
  attachments: Map<string, THREE.Object3D>;
  /** The creature as an effect sees it. */
  view: EffectActor;
  /** The condition the creature has: GitHub's icon for it, at the right end of the HP bar. */
  badge: THREE.Mesh;
  /** Open issues on the creature: the issue icon and how many, at the left end of the HP bar. */
  issueBadge: THREE.Mesh;
  /** Three squares under the HP bar, one filled per attack, for a card whose ability fires every third attack; null for any other card. */
  charge: THREE.Mesh[] | null;
  /** Attacks made since the ability last fired. */
  charged: number;
  /** When each name (or, in the middle look, any name) last showed over the creature, and when the next may show. */
  named: Map<string, number>;
  nextName: number;
  /** Conditions whose word has shown on this creature this fight (the middle look says each once). */
  told: Set<string>;
  grow: number;
  lunge: THREE.Vector3;
  /** Which attack owns the lunge: a newer one takes over, and an older one's tweens stop writing it, so two never fight frame by frame. */
  lungeOwner: number;
  /** When the current attack's lunge is back home. */
  lungeUntil: number;
  /** A shove from the last hit, away from the hitter, that dies out on its own. */
  knock: THREE.Vector3;
  flash: number;
  /** Squash (positive) or stretch (negative) of the body, a spring: a jolt squashes it and it rebounds through a stretch. */
  squash: number;
  squashSpeed: number;
  /** How far a fainting creature tips back, in radians. */
  tilt: number;
  out: boolean;
  won: boolean;
};

type Tween = { start: number; end: number; update: (k: number) => void; done?: () => void };

const BACKDROP = 0x080b0f;
const CELL = 1.3;
const SIZE = 0.7;
const MINE = [0x0e3a25, 0x0a5a2c];
const THEIRS = [0x2a1d24, 0x3a2129];
const FLOOR: [string, number][] = [["#10151b", 0.62], ["#0e2a1d", 0.2], ["#0a3d22", 0.12], ["#14602c", 0.06]];
/** How much of its colour an off-board floor tile keeps, and the most light it may have: about a third of the board's brighter green. */
const FLOOR_SATURATION = 0.4;
const FLOOR_CAP = new THREE.Color(MINE[1]).getHSL({ h: 0, s: 0, l: 0 }).l * 0.35;

const BAR_WIDTH = 0.84;
/** Seconds from a ranged card's ability hit to its number: when a melee lunge lands, which effects/damage.ts times its shard to. */
const ABILITY_HIT_LANDS = 0.11;
/** Only heals and crits get a number, plain with a dark outline; a crit is bigger, yellow, and pops in. */
const HEAL = { color: "#7ee2a8" };
const CRITICAL = { color: "#ffd84d" };
/** A tank lifts this high before it slams down; an assassin dashes this far past the usual reach. */
const SLAM_LIFT = 0.28;
const SLAM_TIME = 0.1;
const DASH_REACH = 0.62;
const DASH_TIME = 0.06;
/** How long the HP a hit took stays white on the bar before it drains, and how fast it drains (about 0.3 s). */
const TRAIL_HOLD = 0.25;
const TRAIL_DRAIN = 10;
/** The body's squash spring: stiff enough to snap back, loose enough to rebound into a small stretch. */
const SQUASH_STIFFNESS = 300;
const SQUASH_DAMPING = 12;
/** A melee hitter draws back this far, for this long, before it lunges. */
const WIND_UP = 0.12;
const WIND_UP_TIME = 0.06;
const REACH = 0.45;
/** How far a hit shoves its target, and how fast the shove dies out. */
const KNOCK = 0.08;
const KNOCK_DECAY = 12;
/** The fight holds still this long when a hit faints its target. */
const HIT_STOP = 0.06;
/** How far a fainting creature tips away from the hit that fainted it, and for how long, before it shrinks. */
const FAINT_TILT = 0.26;
const FAINT_TILT_TIME = 0.12;
/** A strong ease-out: fast away, a long settle. */
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
/** How long a name stays over the creature, in milliseconds. */
const POP_LIFE = 900;
/** Names over one creature show at least this far apart, and the same name at most this often, in fight seconds; the middle look names a creature at most every MIDDLE_REPEAT. */
const NAME_GAP = 0.32;
const NAME_REPEAT = 2.4;
const MIDDLE_REPEAT = 3.5;
/** Fires per second from which the middle look draws a source as regular, then as constant (tierOf). */
const REGULAR_RATE = 0.35;
const CONSTANT_RATE = 1;

/** A run card's role (a plain battle's fighters have no card, and strike as before). */
const roleOfUnit = (unit: BoardUnit) => {
  const card = (unit.fighter as { card?: Card }).card;
  return card ? roleOf(card) : null;
};
const world = (x: number, y: number) => new THREE.Vector3((x - (COLS - 1) / 2) * CELL, 0.1, (ROWS - 0.5 - y) * CELL);

// The Drafts shelf: a row of slots along the player's edge of the board, where bought
// cards wait. Draft pull requests are grey on GitHub, so the shelf is the grey of a draft.
const BENCH_PITCH = 0.98;
const BENCH_Z = ROWS * CELL + 0.95;
const BENCH_X = -0.55;
const BENCH_DEPTH = 1.02;
const BENCH_SCALE = 0.82;
const SHELF_WIDTH = BENCH_SIZE * BENCH_PITCH + 0.34;
/** Each character stands at the open end of its own Drafts shelf, the end away from the Archive (docs/GAME-UI.md §6). */
const TRAINER_X = BENCH_X - SHELF_WIDTH / 2 - 0.42;
/** How far across the floor the two shelves, the Archive and the characters reach. */
const SHELF_REACH = 3.95;
/** The Archive's size on an upright phone, against its size on a wide screen. */
const ARCHIVE_ON_PHONE = 0.72;

/** How far into the free band the scene may reach, as a share of it. */
const FIT_MARGIN = 0.96;
type Frame = { box: THREE.Box3; pitch: number; steepest: number; fov: number; top: number };
/**
 * What the camera keeps in view and how steeply it looks down. A wide screen frames the
 * board with the characters beside it; an upright phone looks down more steeply, so the
 * board's depth fills the height, and keeps the Archive and the player's character in
 * front of the Drafts. `top` is the screen kept clear for the top bar.
 */
const WIDE_FRAME: Frame = { box: new THREE.Box3(new THREE.Vector3(-4.15, 0, -BENCH_Z - 0.35), new THREE.Vector3(4.15, 1.3, BENCH_Z + 0.65)), pitch: 0.82, steepest: 0.82, fov: 34, top: 44 };
const UPRIGHT_FRAME: Frame = { box: new THREE.Box3(new THREE.Vector3(-3.3, 0, -BENCH_Z - 1.25), new THREE.Vector3(3.3, 1.1, BENCH_Z + 1.4)), pitch: 1.0, steepest: 1.17, fov: 40, top: 56 };
const SHELF = 0x2a3038;
const DRAFT = [0x3b434d, 0x353c45];
const DRAFT_LIT = 0x8b949e;
const LEGAL = 0x123d22;
const benchSpot = (slot: number) => new THREE.Vector3(BENCH_X + (slot - (BENCH_SIZE - 1) / 2) * BENCH_PITCH, 0.16, BENCH_Z);
const homeOf = (unit: BoardUnit) => (unit.bench !== undefined ? benchSpot(unit.bench) : world(unit.x, unit.y));

export class BoardWorld {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  private eye = new THREE.Vector3();
  private aim = new THREE.Vector3();
  private cells: THREE.Mesh[] = [];
  private slots: THREE.Mesh[] = [];
  private archive: Archive;
  /** How far the Archive's lid is open, 0 to 1, and a creature being dropped in it. */
  private open = 0;
  private archiving: string | null = null;
  /** The refund shown beside a creature carried over the Archive. */
  private refund: HTMLElement;
  /** Free board cells a creature from the Drafts may take. */
  private room = 0;
  /** Screen pixels the shop covers along the bottom, and how far the view has eased toward it. */
  private inset = 0;
  private shown = 0;
  /** The inset the camera was last fitted to, and the host size, so it refits only when either moves. */
  private fitted = { inset: -1, width: 0, height: 0 };
  private upright = false;
  private probe = new THREE.PerspectiveCamera(36, 1, 0.1, 120);
  private actors = new Map<string, Actor>();
  private trainers: [Trainer | null, Trainer | null] = [null, null];
  private looks: [string, string] = ["", ""];
  private ring: THREE.Mesh;
  private selected: string | null = null;
  private tweens: Tween[] = [];
  private now = 0;
  private clock = 0;
  private last = 0;
  private raf = 0;
  private speed = 1;
  private shake = 0;
  private shakeTime = 0;
  /** Seconds the fight holds still for (HIT_STOP). */
  private stopped = 0;
  private fight: { key: string; ids: [string[], string[]]; events: FightEvent[]; next: number; time: number; done: boolean } | null = null;
  /** The last ability fired: the hits it causes come right after it, in the same tick, from the same card. */
  private cast: { side: Side; unit: number; t: number } | null = null;
  private drag: { id: string; startX: number; startY: number; moved: boolean; spot: Spot | null } | null = null;
  private observer: ResizeObserver;
  private raycaster = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.1);
  private labels = new Set<HTMLElement>();
  private badges = new Map<string, THREE.CanvasTexture>();
  private disposed = false;
  /** How much the fight writes on the board (look.ts). */
  private look = fightLook();
  /** Fires per second of each ability, set and boost in the fight being played, and the ones already named for a team. */
  private rates = new Map<string, number>();
  private sideNamed = new Set<string>();
  /** What an effect may touch on this board (effects/stage.ts). */
  private stage: EffectStage;

  /** Throws when the browser can't give a WebGL context. */
  constructor(
    private host: HTMLElement,
    private options: {
      reduced: boolean;
      lite: boolean;
      onLost: () => void;
      onSelect: (id: string | null) => void;
      onFightEnd: (key: string) => void;
      /** The tick the fight being played has reached, each frame it plays. */
      onTick?: (tick: number) => void;
      /** A creature is being carried (its id), or was put down (null). */
      onDrag: (id: string | null) => void;
      /** A carried creature put down on a cell, a Drafts slot or the Archive. */
      onMove: (id: string, spot: Spot) => void;
      /** What a creature sells for in the Archive, or null when it can't be sold (a board only shown, as on a team page). */
      sellPrice: (id: string) => number | null;
    },
  ) {
    const phone = window.matchMedia("(pointer: coarse)").matches;
    this.renderer = new THREE.WebGLRenderer({ antialias: !options.lite && !(phone && window.devicePixelRatio >= 2) });
    this.renderer.setPixelRatio(options.lite ? 1 : Math.min(window.devicePixelRatio, phone ? 1.75 : 2));
    this.renderer.shadowMap.enabled = !options.lite;
    this.renderer.shadowMap.type = phone ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      if (!this.disposed) options.onLost();
    });
    canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none";
    canvas.setAttribute("aria-hidden", "true");
    host.append(canvas);

    this.scene.background = new THREE.Color(BACKDROP);
    this.scene.fog = new THREE.Fog(BACKDROP, 14, 36);
    this.scene.add(new THREE.HemisphereLight(0xd6e6ff, 0x1c2430, 1.0));
    // A warm key light over the board and the shelf, so the play area is lit and the city around it falls off.
    const key = new THREE.SpotLight(0xffe9c7, 90, 26, 0.62, 0.85, 1.6);
    key.position.set(0.6, 12, 4.5);
    key.target.position.set(0, 0, 1.2);
    this.scene.add(key, key.target);
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.setScalar(phone ? 512 : 1024);
    Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
    sun.shadow.bias = -0.0006;
    this.scene.add(sun);

    this.stage = this.effectStage();
    this.buildFloor();
    this.buildBench();
    this.archive = buildArchive();
    this.scene.add(this.archive.root);
    this.refund = document.createElement("span");
    this.refund.className = "board-refund";
    this.refund.setAttribute("aria-live", "polite");
    host.append(this.refund);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.44, 0.54, 40), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.scene.add(this.ring);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
    canvas.addEventListener("pointerdown", this.down);
    canvas.addEventListener("pointermove", this.move);
    canvas.addEventListener("pointerup", this.up);
    canvas.addEventListener("pointercancel", this.up);
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    for (const label of this.labels) label.remove();
    this.refund.remove();
    for (const texture of this.badges.values()) texture.dispose();
    dispose(this.scene);
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  // --- what the screen asks for ---

  /** The two characters standing at the ends of the board. */
  setLooks(near: Wearer | null, far: Wearer | null) {
    ([near, far] as const).forEach((wearer, side) => {
      const key = wearer ? JSON.stringify(wearer) : "";
      if (key === this.looks[side]) return;
      this.looks[side] = key;
      const old = this.trainers[side];
      if (old) {
        this.scene.remove(old.root);
        dispose(old.root);
      }
      this.trainers[side] = null;
      if (!wearer) return;
      const trainer = buildTrainer(wearer.look, wearer.supporter);
      trainer.root.scale.setScalar(0.8);
      this.scene.add(trainer.root);
      this.trainers[side] = trainer;
    });
    this.post();
  }

  // Where the two characters stand: each at the open end of its own Drafts shelf, the
  // player's by the near shelf, the other's by the far one, the board between them.
  private post() {
    // An upright phone has little floor beside the shelves: each character steps forward of its shelf's end.
    const upright = this.upright;
    // The Archive closes the shelf's far end; a phone has less floor beside it, so the box is smaller there.
    const archive = upright ? ARCHIVE_ON_PHONE : 1;
    this.archive.root.scale.setScalar(archive);
    this.archive.root.position.set(BENCH_X + SHELF_WIDTH / 2 + 0.1 + (ARCHIVE_WIDTH / 2) * archive, 0.02, BENCH_Z - 0.05);
    this.archive.root.rotation.y = upright ? -0.2 : -0.35;
    this.trainers.forEach((trainer, side) => {
      if (!trainer) return;
      const sign = side === 0 ? 1 : -1;
      if (upright) trainer.root.position.set(sign * (TRAINER_X + 0.95), 0.05, sign * (BENCH_Z + 0.85));
      else trainer.root.position.set(sign * TRAINER_X, 0.05, sign * BENCH_Z);
      // Turned to the board: the player's seen from behind, as TFT's is, the other's facing the player.
      trainer.root.rotation.y = side === 0 ? Math.PI * (upright ? 0.9 : 0.82) : -Math.PI * (upright ? 0.1 : 0.18);
    });
  }

  /** Every creature on the board between fights. A new one pops in, a missing one leaves, a moved one walks. */
  setUnits(units: BoardUnit[]) {
    if (this.fight && !this.fight.done) return;
    this.fight = null;
    const wanted = new Map(units.map((unit) => [unit.id, unit]));
    for (const [id, actor] of this.actors) {
      if (wanted.has(id) && wanted.get(id)!.fighter === actor.unit.fighter) continue;
      if (id === this.archiving) this.sink(actor);
      else this.remove(id);
    }
    this.archiving = null;
    for (const unit of units) {
      const actor = this.actors.get(unit.id) ?? this.add(unit);
      actor.unit = unit;
      actor.home.copy(homeOf(unit));
      // On the board a creature faces the other team; on the shelf it turns to the player.
      actor.facing = unit.bench !== undefined ? 0.35 : unit.side === 0 ? Math.PI : 0;
      actor.bar.visible = unit.bench === undefined && !actor.out;
      // Back from a fight: on its feet, at full health.
      if (actor.out || actor.hp !== unit.fighter.hp || actor.won) {
        actor.out = false;
        actor.won = false;
        actor.hp = unit.fighter.hp;
        actor.shield = 0;
        actor.tilt = 0;
        this.clearAttachments(actor);
        actor.bar.visible = unit.bench === undefined;
        actor.badge.visible = false;
        actor.issueBadge.visible = false;
        actor.named.clear();
        actor.nextName = 0;
        actor.told.clear();
        this.charge(actor, 0);
        this.fill(actor);
        if (actor.grow < 1) this.tween(0, 0.35, (k) => (actor.grow = overshoot(k)));
      }
    }
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  /** Lifts the view clear of `pixels` of screen along the bottom. The view eases there. */
  setInset(pixels: number) {
    this.inset = pixels;
  }

  /** How many more creatures the board takes from the Drafts. */
  setRoom(room: number) {
    this.room = room;
  }

  setSpeed(speed: number) {
    this.speed = speed;
  }

  /** Plays a fight from its events. A fight already playing under the same key is left alone. */
  play(fight: BoardFight) {
    if (this.fight?.key === fight.key) return;
    this.fight = { ...fight, next: 0, time: -0.6, done: false };
    for (const actor of this.actors.values()) {
      this.charge(actor, 0);
      actor.told.clear();
      actor.named.clear();
    }
    // How often each ability, set and boost fires in this fight, per second: the middle look draws the busy ones quietly.
    const seconds = Math.max(1, ((fight.events.at(-1)?.t ?? 0) * TICK_MS) / 1000);
    this.rates.clear();
    this.sideNamed.clear();
    for (const event of fight.events) if (event.kind === "ability" && event.t > 0) this.rates.set(event.ability, (this.rates.get(event.ability) ?? 0) + 1 / seconds);
    this.selected = null;
    this.drag = null;
  }

  /** Jumps to the end of the fight being played. */
  skip() {
    if (!this.fight || this.fight.done) return;
    this.fight.time = Infinity;
  }

  /** Where a board cell's middle is on screen. The browser tests drag to it. */
  screenOf(x: number, y: number): Point {
    return this.toScreen(world(x, y));
  }

  /** Where a slot of the player's Drafts shelf is on screen. The browser tests drag from it. */
  screenOfSlot(slot: number): Point {
    return this.toScreen(benchSpot(slot));
  }

  /** Where the Archive's open mouth is on screen. The browser tests drop on it. */
  screenOfArchive(): Point {
    return this.toScreen(this.archive.root.position.clone().setY(0.6));
  }

  /** Where a creature is drawn on screen, or null when it is not on the board. */
  screenOfUnit(id: string): Point | null {
    const actor = this.actors.get(id);
    return actor && !actor.out ? this.toScreen(actor.at.clone().setY(actor.creature.height * SIZE * 0.4)) : null;
  }

  renderInfo(): RenderInfo {
    const { memory, render, programs } = this.renderer.info;
    let objects = 0;
    this.scene.traverse(() => (objects += 1));
    return { calls: render.calls, triangles: render.triangles, geometries: memory.geometries, textures: memory.textures, programs: programs?.length ?? 0, objects, pixelRatio: this.renderer.getPixelRatio() };
  }

  private toScreen(at: THREE.Vector3): Point {
    const point = at.clone().project(this.camera);
    const box = this.renderer.domElement.getBoundingClientRect();
    return { clientX: box.left + (point.x * 0.5 + 0.5) * box.width, clientY: box.top + (-point.y * 0.5 + 0.5) * box.height };
  }

  // --- building ---

  private buildFloor() {
    const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ color: 0x0b0f14 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    this.scene.add(ground);

    // The contribution-graph floor the board sits on.
    const random = seededRandom("board-floor");
    const pitch = 0.74;
    const spots: THREE.Vector3[] = [];
    const colours: THREE.Color[] = [];
    for (let i = -13; i <= 13; i++) {
      for (let j = -13; j <= 13; j++) {
        const x = i * pitch;
        const z = j * pitch;
        const onBoard = Math.abs(x) < COLS * CELL * 0.5 + 0.2 && Math.abs(z) < ROWS * CELL + 0.2;
        const onShelf = Math.abs(x) < SHELF_REACH && Math.abs(z) > ROWS * CELL && Math.abs(z) < BENCH_Z + 0.9;
        if (Math.hypot(x, z) > 9.4 || onBoard || onShelf) continue;
        spots.push(new THREE.Vector3(x, -0.02, z));
        let roll = random();
        // The arena around the board is calm, as TFT's is: the graph's greens greyed and held under a third of the board's own green, darker toward the edges.
        const tone = new THREE.Color((FLOOR.find(([, share]) => (roll -= share) < 0) ?? FLOOR[0])[0]).getHSL({ h: 0, s: 0, l: 0 });
        const falloff = Math.max(0.3, Math.min(1, 1.15 - Math.hypot(x * 0.8, z) / 7.5));
        colours.push(new THREE.Color().setHSL(tone.h, tone.s * FLOOR_SATURATION, Math.min(tone.l, FLOOR_CAP) * falloff));
      }
    }
    const tiles = new THREE.InstancedMesh(new RoundedBoxGeometry(pitch - 0.1, 0.1, pitch - 0.1, 2, 0.04), toon(0xffffff), spots.length);
    tiles.receiveShadow = true;
    const place = new THREE.Object3D();
    spots.forEach((spot, i) => {
      place.position.copy(spot);
      place.updateMatrix();
      tiles.setMatrixAt(i, place.matrix);
      tiles.setColorAt(i, colours[i]);
    });
    this.scene.add(tiles);

    const slab = new RoundedBoxGeometry(CELL - 0.08, 0.16, CELL - 0.08, 3, 0.07);
    for (let y = 0; y < ROWS * 2; y++) {
      for (let x = 0; x < COLS; x++) {
        const cell = new THREE.Mesh(slab, toon((y < ROWS ? MINE : THEIRS)[(x + y) % 2]));
        cell.position.copy(world(x, y)).setY(0.02);
        cell.receiveShadow = true;
        cell.userData = { x, y, colour: (cell.material as THREE.MeshToonMaterial).color.getHex() };
        this.cells.push(cell);
        this.scene.add(cell);
      }
    }

    const skyline = seededRandom("board-skyline");
    const shades = [0x0f151c, 0x131b25, 0x18222e];
    for (let i = 0; i < 54; i++) {
      const angle = (i / 54) * Math.PI * 2 + skyline() * 0.08;
      const distance = 11 + skyline() * 9;
      const tall = 1.5 + skyline() * skyline() * 9;
      const wide = 0.9 + skyline() * 1.6;
      // Only beyond the board and its sides: a tower on the camera's side stands between it and the board, cut by the frame's edge.
      if (Math.sin(angle) > -0.15) continue;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(wide, tall, wide), new THREE.MeshBasicMaterial({ color: shades[i % 3] }));
      tower.position.set(Math.cos(angle) * distance, tall / 2 - 0.06, Math.sin(angle) * distance);
      tower.rotation.y = skyline() * Math.PI;
      this.scene.add(tower);
    }
  }

  private buildBench() {
    this.scene.add(this.shelf(true));
    // The other player's shelf, turned about the board's middle so it lines their edge.
    const theirs = this.shelf(false);
    theirs.rotation.y = Math.PI;
    this.scene.add(theirs);
  }

  /** A Drafts shelf along the near edge. Only the player's own holds slots a card can be dropped in. */
  private shelf(own: boolean): THREE.Group {
    const group = new THREE.Group();
    const shelf = part(new RoundedBoxGeometry(SHELF_WIDTH, 0.24, BENCH_DEPTH + 0.2, 3, 0.07), toon(SHELF), { at: [BENCH_X, -0.02, BENCH_Z] });
    shelf.receiveShadow = true;
    shelf.castShadow = false;
    group.add(shelf);
    // A back rail, a divider between each slot, and a lip along the front with the shelf's name on it.
    group.add(part(new RoundedBoxGeometry(SHELF_WIDTH, 0.3, 0.14, 2, 0.05), toon(0x232930), { at: [BENCH_X, 0.2, BENCH_Z - BENCH_DEPTH / 2 - 0.05] }));
    for (let i = 0; i <= BENCH_SIZE; i++) {
      group.add(part(new RoundedBoxGeometry(0.07, 0.14, BENCH_DEPTH, 2, 0.03), toon(0x232930), { at: [BENCH_X + (i - BENCH_SIZE / 2) * BENCH_PITCH, 0.15, BENCH_Z] }));
    }
    const lip = part(new RoundedBoxGeometry(SHELF_WIDTH, 0.3, 0.14, 2, 0.05), toon(0x1d2228), { at: [BENCH_X, 0.03, BENCH_Z + BENCH_DEPTH / 2 + 0.1] });
    lip.castShadow = false;
    group.add(lip);
    const label = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.3), new THREE.MeshBasicMaterial({ map: this.lipLabel(), transparent: true }));
    label.position.set(BENCH_X, 0.03, BENCH_Z + BENCH_DEPTH / 2 + 0.172);
    group.add(label);
    const tile = new RoundedBoxGeometry(BENCH_PITCH - 0.12, 0.08, BENCH_DEPTH - 0.16, 3, 0.035);
    for (let slot = 0; slot < BENCH_SIZE; slot++) {
      const mesh = new THREE.Mesh(tile, toon(DRAFT[slot % 2]));
      mesh.position.copy(benchSpot(slot)).setY(0.12);
      mesh.receiveShadow = true;
      group.add(mesh);
      if (!own) continue;
      mesh.userData = { slot, colour: DRAFT[slot % 2] };
      this.slots.push(mesh);
    }
    return group;
  }

  /** "Drafts" with GitHub's draft pull request mark, drawn for the shelf's front lip. */
  private lipLabel(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 96;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    const draw = () => {
      const pen = canvas.getContext("2d")!;
      pen.clearRect(0, 0, 768, 96);
      pen.strokeStyle = pen.fillStyle = "#8b949e";
      pen.lineWidth = 5;
      pen.font = "700 50px 'Clash Display', system-ui, sans-serif";
      pen.letterSpacing = "10px";
      const word = pen.measureText("DRAFTS").width;
      pen.translate((768 - word - 90) / 2, 16);
      // The draft pull request mark: a ring, a line up to a second ring, and the dashes of a branch not yet opened.
      pen.beginPath();
      pen.arc(24, 46, 8, 0, Math.PI * 2);
      pen.moveTo(24, 38);
      pen.lineTo(24, 26);
      pen.moveTo(32, 18);
      pen.arc(24, 18, 8, 0, Math.PI * 2);
      pen.stroke();
      for (const y of [16, 30]) pen.fillRect(54, y, 6, 8);
      pen.beginPath();
      pen.arc(57, 46, 8, 0, Math.PI * 2);
      pen.stroke();
      pen.textBaseline = "middle";
      pen.fillText("DRAFTS", 90, 34);
      pen.setTransform(1, 0, 0, 1, 0, 0);
      texture.needsUpdate = true;
    };
    draw();
    void document.fonts?.load("700 50px 'Clash Display'").then(() => !this.disposed && draw());
    return texture;
  }

  private add(unit: BoardUnit): Actor {
    const creature = buildCreature(unit.fighter);
    creature.root.traverse((child) => (child.userData.actor = unit.id));
    const bar = new THREE.Group();
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.12), new THREE.MeshBasicMaterial({ color: 0x05070a, depthTest: false, transparent: true, opacity: 0.85 }));
    const fill = new THREE.Mesh(new THREE.PlaneGeometry(BAR_WIDTH, 0.07), new THREE.MeshBasicMaterial({ color: unit.side === 0 ? 0x35c450 : 0xe5484d, depthTest: false, transparent: true }));
    fill.position.z = 0.002;
    const shieldFill = new THREE.Mesh(new THREE.PlaneGeometry(BAR_WIDTH, 0.07), new THREE.MeshBasicMaterial({ color: EFFECT_COLOR.shield, depthTest: false, transparent: true }));
    shieldFill.position.z = 0.003;
    shieldFill.visible = false;
    const trailFill = new THREE.Mesh(new THREE.PlaneGeometry(BAR_WIDTH, 0.07), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.85 }));
    trailFill.position.z = 0.001;
    back.renderOrder = 10;
    trailFill.renderOrder = 11;
    fill.renderOrder = 11;
    shieldFill.renderOrder = 11;
    const worded = this.look === "gif";
    const badge = new THREE.Mesh(worded ? new THREE.PlaneGeometry(0.84, 0.21) : new THREE.PlaneGeometry(0.26, 0.26), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
    if (worded) badge.position.set(0, 0.19, 0.004);
    else badge.position.set(BAR_WIDTH / 2 + 0.17, 0, 0.004);
    badge.renderOrder = 12;
    badge.visible = false;
    // The badge picks its creature as the body does (actorUnder).
    badge.userData.actor = unit.id;
    const issueBadge = new THREE.Mesh(new THREE.PlaneGeometry(0.48, 0.24), new THREE.MeshBasicMaterial({ depthTest: false, transparent: true }));
    issueBadge.position.set(-BAR_WIDTH / 2 - 0.28, 0, 0.004);
    issueBadge.renderOrder = 12;
    issueBadge.visible = false;
    bar.add(back, trailFill, fill, shieldFill, badge, issueBadge);
    const charge = !worded && abilityHooks((unit.fighter as { card?: Card }).card?.ability ?? "").some((hook) => hook.on === "third")
      ? [-1, 0, 1].map((i) => {
          const square = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.05), new THREE.MeshBasicMaterial({ color: EFFECT_COLOR.fired, depthTest: false, transparent: true }));
          square.position.set(i * 0.13, -0.1, 0.004);
          square.renderOrder = 12;
          bar.add(square);
          return square;
        })
      : null;
    // Turn first, then tip: a faint tips the creature back the way it faces.
    creature.root.rotation.order = "YXZ";
    this.scene.add(creature.root, bar);
    const home = homeOf(unit);
    const actor = { unit, creature, home, at: home.clone(), facing: 0, hp: unit.fighter.hp, shield: 0, bar, fill, shieldFill, trailFill, trail: 1, trailHold: 0, attachments: new Map(), badge, issueBadge, charge, charged: 0, named: new Map(), nextName: 0, told: new Set(), grow: 0, lunge: new THREE.Vector3(), lungeOwner: 0, lungeUntil: 0, knock: new THREE.Vector3(), flash: 0, squash: 0, squashSpeed: 0, tilt: 0, out: false, won: false } as Omit<Actor, "view"> as Actor;
    this.charge(actor, 0);
    actor.view = {
      side: unit.side,
      get at() {
        return actor.creature.root.position;
      },
      get height() {
        return actor.creature.height * SIZE * (actor.creature.root.userData.scale as THREE.Vector3).y;
      },
      get out() {
        return actor.out;
      },
      jolt: (squash, flash) => {
        actor.squash = Math.max(actor.squash, squash);
        actor.flash = Math.max(actor.flash, flash);
      },
    };
    this.actors.set(unit.id, actor);
    this.tween(0, 0.4, (k) => (actor.grow = overshoot(k)));
    return actor;
  }

  private remove(id: string) {
    const actor = this.actors.get(id);
    if (!actor) return;
    this.actors.delete(id);
    this.clearAttachments(actor);
    this.scene.remove(actor.creature.root, actor.bar);
    dispose(actor.creature.root);
    dispose(actor.bar);
  }

  /** A sold creature drops into the Archive and the lid shuts on it. */
  private sink(actor: Actor) {
    this.actors.delete(actor.unit.id);
    this.clearAttachments(actor);
    this.scene.remove(actor.bar);
    dispose(actor.bar);
    const root = actor.creature.root;
    const from = root.position.clone();
    const to = this.archive.root.position.clone().setY(0.35);
    const size = root.scale.clone();
    const done = () => {
      this.scene.remove(root);
      dispose(root);
    };
    if (this.options.reduced) return done();
    this.open = 1;
    this.tween(0, 0.26, (k) => {
      root.position.lerpVectors(from, to, k).setY(from.y + (to.y - from.y) * k + Math.sin(k * Math.PI) * 0.5);
      root.scale.copy(size).multiplyScalar(Math.max(0.001, 1 - k * k));
    }, done);
  }

  /** The HP bar: HP from the left, then any shield after it. A shield that would run past the end shrinks the HP to make room, as TFT's bar does. */
  private fill(actor: Actor, hurt = false) {
    const total = Math.max(actor.unit.fighter.hp, actor.hp + actor.shield);
    const hpShare = Math.max(0, Math.min(1, actor.hp / total));
    const shieldShare = Math.max(0, Math.min(1 - hpShare, actor.shield / total));
    const left = -BAR_WIDTH / 2;
    actor.fill.scale.x = Math.max(0.001, hpShare);
    actor.fill.position.x = left + (BAR_WIDTH * hpShare) / 2;
    // Only lost HP leaves a white trail; a heal, or a shield making room on the bar, moves it at once.
    if (hurt && hpShare < actor.trail) actor.trailHold = TRAIL_HOLD;
    else actor.trail = hpShare;
    this.fillTrail(actor);
    actor.shieldFill.visible = shieldShare > 0;
    actor.shieldFill.scale.x = Math.max(0.001, shieldShare);
    actor.shieldFill.position.x = left + BAR_WIDTH * hpShare + (BAR_WIDTH * shieldShare) / 2;
  }

  private fillTrail(actor: Actor) {
    actor.trailFill.scale.x = Math.max(0.001, actor.trail);
    actor.trailFill.position.x = -BAR_WIDTH / 2 + (BAR_WIDTH * actor.trail) / 2;
  }

  private clearAttachments(actor: Actor) {
    for (const object of actor.attachments.values()) dispose(object);
    actor.attachments.clear();
  }

  private effectStage(): EffectStage {
    const options = this.options;
    return {
    scene: this.scene,
    camera: this.camera,
    get reduced() {
      return options.reduced;
    },
    tween: (delay, duration, update, done) => this.tween(delay, duration, update, done),
    after: (delay, done) => this.after(delay, done),
    pointOn: (view, height) => view.at.clone().setY(view.at.y + view.height * height),
    spawn: (object, life) => {
      this.scene.add(object);
      this.after(life, () => dispose(object));
    },
    attach: (view, key, object) => {
      const actor = this.actorOf(view);
      if (!actor || actor.out) return dispose(object);
      const old = actor.attachments.get(key);
      if (old) dispose(old);
      actor.attachments.set(key, object);
      this.scene.add(object);
    },
    detach: (view, key) => {
      const actor = this.actorOf(view);
      const object = actor?.attachments.get(key);
      if (!actor || !object) return;
      actor.attachments.delete(key);
      dispose(object);
    },
    attached: (view, key) => this.actorOf(view)?.attachments.get(key),
    };
  }

  private actorOf(view: EffectActor): Actor | undefined {
    for (const actor of this.actors.values()) if (actor.view === view) return actor;
    return undefined;
  }

  // --- the fight ---

  private apply(event: FightEvent, quick: boolean) {
    const fight = this.fight!;
    if (event.kind === "end") {
      fight.done = true;
      for (const actor of this.actors.values()) actor.won = !actor.out && event.winner === actor.unit.side && actor.unit.bench === undefined;
      this.after(quick ? 0.2 : 1.1, () => !this.disposed && this.fight === fight && this.options.onFightEnd(fight.key));
      return;
    }
    const actor = this.actors.get(fight.ids[event.side][event.unit]);
    if (!actor) return;
    if (event.kind === "move") {
      actor.home.copy(world(event.x, event.y));
    } else if (event.kind === "faint") {
      actor.out = true;
      actor.bar.visible = false;
      this.clearAttachments(actor);
      if (quick) actor.grow = 0;
      else {
        if (!this.options.reduced) this.tween(0, FAINT_TILT_TIME, (k) => (actor.tilt = FAINT_TILT * easeOut(k)));
        this.tween(FAINT_TILT_TIME, 0.4, (k) => (actor.grow = 1 - easeOut(k)));
      }
    } else if (event.kind === "ability") {
      this.cast = { side: event.side, unit: event.unit, t: event.t };
      if (actor.charge && hookOf(event.ability)?.on === "third") this.after(quick ? 0 : 0.3, () => this.charge(actor, 0));
      if (quick) return;
      // At fight start every set bonus and boost fires on every card it lifts. A buff there is a short glow and no more,
      // so the board doesn't jump; the set panel already says which sets are live.
      const hook = hookOf(event.ability);
      if (this.look === "gif") this.name(actor, event.ability);
      else if (hook?.on === "start" && hook.effects.every((effect) => effect.kind === "stat" || effect.kind === "shield")) {
        actor.flash = Math.max(actor.flash, 0.6);
        return;
      } else if (this.look === "middle") {
        // Loudness follows how often the thing fires this fight. A rare one is named every time; a regular one the first time
        // on each card; a constant one (lifesteal on every attack) is named once per team and plays its effect once per card,
        // then only flashes the card.
        const tier = this.tierOf(event.ability);
        const first = !actor.told.has(`fired:${event.ability}`);
        actor.told.add(`fired:${event.ability}`);
        if (tier === "constant" && !first) {
          actor.flash = Math.max(actor.flash, 0.3);
          return;
        }
        const team = `${event.side}:${event.ability}`;
        if (tier === "rare" || (first && (tier === "regular" || !this.sideNamed.has(team)))) {
          this.sideNamed.add(team);
          this.name(actor, event.ability, tier === "rare");
        }
      }
      const ids = fight.ids;
      const reached = (onFoes: boolean) => {
        const side = onFoes === (event.side === 0) ? 1 : 0;
        return event.targets.flatMap((index) => this.actors.get(ids[side][index])?.view ?? []);
      };
      playFired(this.stage, event.ability, actor.view, reached);
    } else if (event.kind === "shield") {
      // A shield reads as a required check: ✓ when one goes up, a red ✗ when it is broken.
      actor.shield = event.shield;
      this.fill(actor);
      if (event.shield === 0) this.stage.detach(actor.view, SHIELD_KEY);
    } else if (event.kind === "hp") {
      actor.hp = Math.max(0, Math.min(actor.unit.fighter.hp, actor.hp + event.change));
      this.fill(actor, event.change < 0);
      if (quick) return;
      // Only a heal gets a number: a bleed or an open issue shows as the HP bar draining (the gif look numbers both).
      if (this.look === "gif" && event.change < 0) this.label(this.over(actor, 0.25), String(event.change), { color: CONDITION_COLOR[event.cause as Condition] ?? "#ff8f93" });
      if (event.change > 0) {
        actor.flash = 0.5;
        // A constant heal (lifesteal) shows its number the first time on each card, then only the HP bar fills.
        const quiet = this.look === "middle" && this.tierOf(event.cause) === "constant" && actor.told.has(`healed:${event.cause}`);
        actor.told.add(`healed:${event.cause}`);
        if (!quiet) this.label(this.over(actor, 0.25), `+${event.change}`, HEAL);
      }
    } else if (event.kind === "issues") {
      // Open issues read as GitHub's: the green issue icon and how many, beside the HP bar; a heal closes them all.
      actor.issueBadge.visible = event.issues > 0;
      if (event.issues > 0) {
        const material = actor.issueBadge.material as THREE.MeshBasicMaterial;
        material.map = this.badgeFor(`issues:${event.issues}`, () => iconTexture("issue-opened", ISSUE_COLOR, event.issues));
        material.needsUpdate = true;
      }
    } else if (event.kind === "condition") {
      const condition = event.condition as Condition;
      actor.badge.visible = event.on && condition in CONDITION_NAMES;
      if (actor.badge.visible) {
        const material = actor.badge.material as THREE.MeshBasicMaterial;
        material.map = this.look === "gif" ? this.badgeFor(`word:${condition}`, () => wordTexture(condition)) : this.badgeFor(condition, () => iconTexture(CONDITION_ICON[condition], CONDITION_COLOR[condition]));
        material.needsUpdate = true;
        // The middle look says the condition's word the first time it lands on a creature, then leaves the icon.
        if (this.look === "middle" && !quick && !actor.told.has(condition)) {
          actor.told.add(condition);
          this.label(this.over(actor, 0.45), CONDITION_NAMES[condition], { color: CONDITION_COLOR[condition], size: 13, life: 1100 });
        }
      }
    } else if (event.kind === "hit") {
      const target = this.actors.get(fight.ids[event.side === 0 ? 1 : 0][event.target]);
      if (!target) return;
      target.hp = Math.max(0, target.hp - event.damage);
      const cast = this.cast;
      const fromAbility = cast !== null && cast.side === event.side && cast.unit === event.unit && cast.t === event.t;
      // An attack, not an ability's hit, fills a charge square; the third fires the ability and empties them.
      if (!fromAbility && actor.charge) this.charge(actor, (actor.charged % 3) + 1);
      if (quick) return this.fill(target, true);
      const reduced = this.options.reduced;
      const toward = target.home.clone().sub(actor.home);
      actor.facing = Math.atan2(toward.x, toward.z);
      const away = toward.setY(0).normalize();
      const fainted = target.hp === 0;
      // A fainting creature turns to the one that fainted it, so it tips straight back.
      if (fainted) target.facing = actor.facing + Math.PI;
      const land = () => {
        this.fill(target, true);
        target.flash = 1;
        target.squash = event.critical ? 0.3 : 0.16;
        target.squashSpeed = 0;
        if (!reduced) {
          // Hits close together push no farther than one: stacked shoves made a creature hit by several shiver.
          target.knock.addScaledVector(away, KNOCK).clampLength(0, KNOCK);
          if (event.critical) this.shake = 0.12;
          if (fainted) this.stopped = HIT_STOP;
        }
        // Today only a crit gets a number; the gif and middle looks number every hit, the middle one small.
        if (event.critical) this.label(this.over(target, 0.25), `−${event.damage}`, { ...CRITICAL, size: 21, pop: 1.5 });
        else if (this.look === "gif") this.label(this.over(target, 0.25), String(event.damage), {});
        else if (this.look === "middle") this.label(this.over(target, 0.25), String(event.damage), { size: 12, pop: 1.1 });
      };
      // An attack can start before the last one's lunge is home (a fast card), and an ability's extra hit
      // lands in the same tick as the attack that set it off. Each new lunge starts from where the creature is
      // and owns the lunge from then on; an extra hit during a lunge rides on it instead of starting another.
      let owner = 0;
      const mine = (update: (k: number) => void) => (k: number) => {
        if (actor.lungeOwner === owner) update(k);
      };
      const start = actor.lunge.clone();
      const busy = this.now < actor.lungeUntil;
      if (reduced) {
        land();
      } else if (fromAbility && (actor.unit.ranged || busy)) {
        // A ranged ability's damage flies as its own shard (effects/damage.ts), so the card's ball would be a second shot;
        // a melee card mid-lunge already reaches the target, so a second lunge would only fight the first.
        this.after(ABILITY_HIT_LANDS, land);
      } else if (actor.unit.ranged) {
        const color = actor.unit.fighter.color && /^#[0-9a-f]{6}$/i.test(actor.unit.fighter.color) ? actor.unit.fighter.color : 0xffffff;
        const big = this.look === "middle";
        const shot = new THREE.Mesh(sphere(big ? 0.15 : 0.11, 10), new THREE.MeshBasicMaterial({ color }));
        // The middle look gives the shot a short trail of fading balls, so a throw reads across the board.
        const trail = big ? [0.11, 0.08, 0.05].map((size, i) => new THREE.Mesh(sphere(size, 8), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 - i * 0.14, depthWrite: false }))) : [];
        const from = actor.at.clone().setY(actor.creature.height * SIZE * 0.6);
        const to = target.at.clone().setY(target.creature.height * SIZE * 0.5);
        this.scene.add(shot, ...trail);
        trail.forEach((ball) => (ball.visible = false));
        actor.squash = 0.14;
        // A throw: the thrower rocks back, and the shot leaves fast and slows as it arrives.
        const rock = away.clone().multiplyScalar(-0.1);
        owner = ++actor.lungeOwner;
        actor.lungeUntil = this.now + 0.2;
        this.tween(0, 0.05, mine((k) => actor.lunge.lerpVectors(start, rock, easeOut(k))));
        this.tween(0.05, 0.15, mine((k) => actor.lunge.copy(rock).multiplyScalar(1 - easeOut(k))));
        const place = (ball: THREE.Object3D, along: number) => ball.position.lerpVectors(from, to, along).setY(from.y + (to.y - from.y) * along + Math.sin(along * Math.PI) * 0.5);
        this.tween(0, 0.22, (k) => {
          const along = 1 - (1 - k) ** 2;
          place(shot, along);
          trail.forEach((ball, i) => {
            const behind = along - 0.08 * (i + 1);
            ball.visible = behind > 0;
            place(ball, Math.max(0, behind));
          });
        }, () => {
          for (const ball of [shot, ...trail]) {
            this.scene.remove(ball);
            dispose(ball);
          }
          land();
        });
      } else if (!fromAbility && roleOfUnit(actor.unit) === "tank") {
        // A tank's hit is a slam: it rises, comes down on the target, and the floor shakes out.
        const lift = new THREE.Vector3(0, SLAM_LIFT, 0).addScaledVector(away, -WIND_UP);
        const reach = away.clone().multiplyScalar(REACH * 0.7);
        owner = ++actor.lungeOwner;
        actor.lungeUntil = this.now + SLAM_TIME + ABILITY_HIT_LANDS * 0.7 + 0.24;
        this.tween(0, SLAM_TIME, mine((k) => actor.lunge.lerpVectors(start, lift, easeOut(k))));
        this.tween(SLAM_TIME, ABILITY_HIT_LANDS * 0.7, mine((k) => actor.lunge.lerpVectors(lift, reach, k * k)), () => {
          land();
          this.floorRing(target.at, "#c9d1d9", 0.3);
        });
        this.tween(SLAM_TIME + ABILITY_HIT_LANDS * 0.7, 0.24, mine((k) => actor.lunge.copy(reach).multiplyScalar(1 - easeOut(k))));
      } else if (!fromAbility && roleOfUnit(actor.unit) === "assassin") {
        // An assassin's hit is a dash: no wind-up, in fast and past, and a slash across the target.
        const reach = away.clone().multiplyScalar(DASH_REACH);
        owner = ++actor.lungeOwner;
        actor.lungeUntil = this.now + DASH_TIME + 0.16;
        this.tween(0, DASH_TIME, mine((k) => actor.lunge.lerpVectors(start, reach, easeOut(k))), () => {
          land();
          this.slash(target, away);
        });
        this.tween(DASH_TIME, 0.16, mine((k) => actor.lunge.copy(reach).multiplyScalar(1 - easeOut(k))));
      } else {
        // An ability's lunge lands when effects/damage.ts's shard does, so only a plain hit draws back first.
        const windUp = fromAbility ? 0 : WIND_UP_TIME;
        const back = windUp ? away.clone().multiplyScalar(-WIND_UP) : start;
        const reach = away.clone().multiplyScalar(REACH);
        owner = ++actor.lungeOwner;
        actor.lungeUntil = this.now + windUp + ABILITY_HIT_LANDS + 0.2;
        if (windUp) this.tween(0, windUp, mine((k) => actor.lunge.lerpVectors(start, back, easeOut(k))));
        this.tween(windUp, ABILITY_HIT_LANDS, mine((k) => actor.lunge.lerpVectors(back, reach, easeOut(k))), land);
        this.tween(windUp + ABILITY_HIT_LANDS, 0.2, mine((k) => actor.lunge.copy(reach).multiplyScalar(1 - easeOut(k))));
      }
    }
  }

  /** A flat ring that opens on the floor around `at` and fades: a tank's slam landing. */
  private floorRing(at: THREE.Vector3, color: string, life: number) {
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.38, 40), material);
    ring.rotation.x = -Math.PI / 2;
    ring.position.copy(at).setY(0.13);
    this.scene.add(ring);
    this.tween(0, life, (k) => {
      ring.scale.setScalar(1 + easeOut(k) * 1.1);
      material.opacity = 0.8 * (1 - k);
    }, () => {
      this.scene.remove(ring);
      dispose(ring);
    });
  }

  /** A thin white arc swept across the target, square to the way the blow came: an assassin's cut. */
  private slash(target: Actor, away: THREE.Vector3) {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.025, 4, 24, Math.PI * 0.7), material);
    arc.renderOrder = 5;
    arc.position.copy(target.at).setY(target.creature.height * SIZE * 0.5);
    arc.lookAt(arc.position.clone().add(away));
    arc.rotateZ(Math.PI * 0.65);
    this.scene.add(arc);
    this.tween(0, 0.16, (k) => {
      arc.rotateZ(-0.12);
      material.opacity = 1 - k * k;
    }, () => {
      this.scene.remove(arc);
      dispose(arc);
    });
  }

  /** A point `above` over the creature's HP bar, so what is drawn there never covers the bar. */
  private over(actor: Actor, above: number) {
    return actor.at.clone().setY(actor.bar.position.y + above);
  }

  /** A number that pops on, rises over the board and fades. With reduced motion it only fades, in place. */
  private label(at: THREE.Vector3, text: string, style: { color?: string; size?: number; pop?: number; life?: number }) {
    const point = at.project(this.camera);
    const label = document.createElement("span");
    label.textContent = text;
    const life = style.life ?? 650;
    label.style.cssText = `position:absolute;left:${(point.x * 0.5 + 0.5) * 100}%;top:${(-point.y * 0.5 + 0.5) * 100}%;transform:translate(-50%,-100%);pointer-events:none;z-index:5;font:700 ${style.size ?? 15}px/1.2 var(--font-display, system-ui);color:${style.color ?? "#fff"};text-shadow:0 1px 0 #000,0 0 6px #000`;
    this.host.append(label);
    this.labels.add(label);
    const pop = style.pop ?? 1.25;
    const frames: Keyframe[] = this.options.reduced
      ? [{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }]
      : [
          { transform: `translate(-50%,-100%) scale(${pop})`, opacity: 1, easing: EASE_OUT },
          { transform: "translate(-50%,-110%) scale(1)", opacity: 1, offset: 0.18, easing: "ease-out" },
          { transform: "translate(-50%,-160%) scale(1)", opacity: 1, offset: 0.6, easing: EASE_OUT },
          { transform: "translate(-50%,-190%) scale(1)", opacity: 0 },
        ];
    label.animate(frames, { duration: life, fill: "forwards" });
    setTimeout(() => {
      label.remove();
      this.labels.delete(label);
    }, life);
  }

  /** How often `source` fires in this fight: measured on 120 round-3 and round-5 fights, lifesteal, thorns, the apps set and
   * combo fire 1 to 3 times a second; revert, open issues and add tests about once every 1-2 s; blast radius, hotfix and
   * legacy code less than once every 3 s. */
  private tierOf(source: string): "rare" | "regular" | "constant" {
    const rate = this.rates.get(source) ?? 0;
    return rate >= CONSTANT_RATE ? "constant" : rate >= REGULAR_RATE ? "regular" : "rare";
  }

  /** The name of what fired, a small gold word over the creature for under a second. It sits above the HP bar, never on it. */
  private pop(at: THREE.Vector3, id: string) {
    const name = sourceOf(id).name;
    const point = at.project(this.camera);
    const word = document.createElement("span");
    word.className = "ability-pop";
    word.dataset.named = name;
    word.textContent = name;
    word.style.cssText = `left:${(point.x * 0.5 + 0.5) * 100}%;top:${(-point.y * 0.5 + 0.5) * 100}%;--life:${POP_LIFE}ms`;
    this.host.append(word);
    this.labels.add(word);
    setTimeout(() => {
      word.remove();
      this.labels.delete(word);
    }, POP_LIFE);
  }

  /** Names what fired over the creature: in the gif look each name at most every NAME_REPEAT, in the middle look any name at most every MIDDLE_REPEAT. */
  private name(actor: Actor, id: string, rare = false) {
    const key = this.look === "gif" ? id : "any";
    const last = actor.named.get(key);
    if (!rare && last !== undefined && this.now - last < (this.look === "gif" ? NAME_REPEAT : MIDDLE_REPEAT)) return;
    actor.named.set(key, this.now);
    const at = Math.max(this.now, actor.nextName);
    actor.nextName = at + NAME_GAP;
    const fight = this.fight;
    this.after(at - this.now, () => {
      if (this.disposed || this.fight !== fight || actor.out) return;
      actor.squash = Math.max(actor.squash, 0.1);
      this.pop(this.over(actor, 0.18), id);
    });
  }

  /** Fills `count` of the creature's three charge squares; the rest show dim. */
  private charge(actor: Actor, count: number) {
    actor.charged = count;
    actor.charge?.forEach((square, i) => ((square.material as THREE.MeshBasicMaterial).opacity = i < count ? 1 : 0.25));
  }

  /** A badge texture, made once per key and kept until the board goes. */
  private badgeFor(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
    let texture = this.badges.get(key);
    if (!texture) this.badges.set(key, (texture = make()));
    return texture;
  }

  // --- time ---

  private tween(delay: number, duration: number, update: (k: number) => void, done?: () => void) {
    this.tweens.push({ start: this.now + delay, end: this.now + delay + duration, update, done });
  }

  private after(delay: number, done: () => void) {
    this.tween(delay, 0, () => {}, done);
  }

  private frame = (ms: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const seconds = Math.min(0.05, (ms - this.last) / 1000);
    this.last = ms;
    // A hit-stop holds the fight, and everything moving in it, still; the camera's shake goes on.
    const held = this.stopped > 0;
    this.stopped = Math.max(0, this.stopped - seconds);
    const step = held ? 0 : seconds * this.speed;
    this.now += step;
    if (!this.options.reduced) this.clock += seconds;

    const fight = this.fight;
    if (fight && !fight.done) {
      const quick = fight.time === Infinity;
      fight.time += step;
      while (!fight.done && fight.next < fight.events.length && (fight.events[fight.next].t * TICK_MS) / 1000 <= fight.time) this.apply(fight.events[fight.next++], quick);
      if (quick) for (const actor of this.actors.values()) actor.at.copy(actor.home);
      // A skipped fight's time is Infinity: its last tick is the end event's.
      const last = fight.events.at(-1)?.t ?? 0;
      this.options.onTick?.(Math.min(last, Math.max(0, Math.floor((fight.time * 1000) / TICK_MS))));
    }

    // A tween's update or done may start another tween; those go on the fresh list, so none is dropped.
    const running = this.tweens;
    this.tweens = [];
    const kept = running.filter((tween) => {
      if (this.now < tween.start) return true;
      const k = tween.end === tween.start ? 1 : Math.min(1, (this.now - tween.start) / (tween.end - tween.start));
      tween.update(k);
      if (k < 1) return true;
      tween.done?.();
      return false;
    });
    this.tweens = [...kept, ...this.tweens];

    this.pose(seconds, held ? 0 : seconds);
    this.renderer.render(this.scene, this.camera);
  };

  /** `moving` is `seconds`, or 0 while a hit-stop holds the creatures still. */
  private pose(seconds: number, moving: number) {
    const dragging = this.drag?.moved ? this.drag.id : null;
    for (const [id, actor] of this.actors) {
      const { creature } = actor;
      const t = this.clock + creature.phase;
      // The creature trails toward where it stands, so a walk and a swap are both a glide.
      if (id !== dragging) actor.at.lerp(actor.home, 1 - Math.exp(-moving * this.speed * 9));
      const walking = id !== dragging && actor.at.distanceTo(actor.home) > 0.06;
      const hop = actor.won ? Math.abs(Math.sin(t * 5)) * 0.3 : walking ? Math.abs(Math.sin(this.now * 14)) * 0.12 : 0;
      const breath = this.options.reduced ? 0 : Math.sin(t * 2.3) * 0.028;
      actor.squashSpeed += (-SQUASH_STIFFNESS * actor.squash - SQUASH_DAMPING * actor.squashSpeed) * moving;
      actor.squash += actor.squashSpeed * moving;
      actor.flash = Math.max(0, actor.flash - moving * 6);
      actor.knock.multiplyScalar(Math.exp(-moving * KNOCK_DECAY));
      if (actor.trailHold > 0) actor.trailHold = Math.max(0, actor.trailHold - moving);
      else if (actor.trail > actor.fill.scale.x) {
        actor.trail -= (actor.trail - actor.fill.scale.x) * (1 - Math.exp(-moving * TRAIL_DRAIN));
        if (actor.trail - actor.fill.scale.x < 0.002) actor.trail = actor.fill.scale.x;
        this.fillTrail(actor);
      }
      const base = creature.root.userData.scale as THREE.Vector3;
      creature.root.position.copy(actor.at).add(actor.lunge).add(actor.knock);
      if (id === dragging) creature.root.position.y += this.drag?.spot?.kind === "archive" ? 1.0 : 0.45;
      const shelved = actor.unit.bench !== undefined && id !== dragging;
      creature.root.scale.copy(base).multiplyScalar(SIZE * actor.grow * (id === this.selected ? 1.08 : 1) * (shelved ? BENCH_SCALE : 1) * (id === dragging ? 1.1 : 1));
      creature.root.visible = actor.grow > 0.02;
      creature.root.rotation.y += (((actor.facing - creature.root.rotation.y + Math.PI * 3) % (Math.PI * 2)) - Math.PI) * Math.min(1, moving * 12);
      creature.root.rotation.x = -actor.tilt;
      creature.body.position.y = hop + (creature.floats ? 0.3 + Math.sin(t * 1.7) * 0.08 : 0);
      creature.body.scale.set(1 - breath * 0.5 + actor.squash * 0.6, 1 + breath - actor.squash, 1 - breath * 0.5 + actor.squash * 0.6);
      const blink = t % 3.6 < 0.11 ? 0.12 : 1;
      for (const eye of creature.eyes) eye.scale.y = blink;
      creature.limbs.forEach((limb, i) => (limb.rotation.x = Math.sin(t * 2.3 + i * Math.PI) * 0.16));
      for (const spinner of creature.spinners) spinner.rotation.y = t * 0.9;
      for (const skin of creature.skins) skin.emissive.setScalar(actor.flash * 0.8);
      actor.bar.position.copy(creature.root.position).setY(creature.height * SIZE * base.y + 0.55 + (id === dragging ? 0.45 : 0));
      for (const object of actor.attachments.values()) {
        object.position.copy(creature.root.position);
        object.visible = creature.root.visible;
      }
      actor.bar.quaternion.copy(this.camera.quaternion);
    }

    this.poseArchive(seconds);

    const chosen = this.selected ? this.actors.get(this.selected) : undefined;
    this.ring.visible = Boolean(chosen) && !chosen!.out;
    if (chosen) {
      this.ring.position.copy(chosen.at).setY(0.12);
      this.ring.scale.setScalar(1 + Math.sin(this.clock * 4) * 0.05);
    }

    this.trainers.forEach((trainer, side) => {
      if (!trainer) return;
      const beat = this.clock + side * 1.3;
      const won = this.fight?.done ? [...this.actors.values()].some((actor) => actor.won && actor.unit.side === side) : false;
      trainer.root.position.y = 0.05 + (won ? Math.abs(Math.sin(beat * 5)) * 0.22 : 0);
      trainer.head.rotation.y = Math.sin(beat * 0.6) * 0.12;
      trainer.arms[0].rotation.x = -Math.sin(beat * 1.4) * 0.04;
      trainer.arms[1].rotation.x = Math.sin(beat * 1.4) * 0.04;
      trainer.arms[0].rotation.z = won ? -2.7 : -0.12;
      trainer.arms[1].rotation.z = won ? 2.7 : 0.12;
    });

    // The shake is two fast sines that die out: a jolt with weight, not a buzz of random jumps.
    this.shake = Math.max(0, this.shake - seconds * 0.6);
    this.shakeTime += seconds;
    const shakeX = Math.sin(this.shakeTime * 47) * this.shake * 0.5;
    const shakeY = Math.sin(this.shakeTime * 61 + 1.3) * this.shake * 0.4;
    const drift = this.options.reduced ? 0 : 1;
    this.camera.position.set(this.eye.x + drift * Math.sin(this.clock * 0.3) * 0.12 + shakeX, this.eye.y + shakeY, this.eye.z);
    this.camera.lookAt(this.aim);
    // The shop covers the bottom of the screen: draw the scene as the top part of a taller picture, so the board centres above it.
    const ease = this.options.reduced ? 1 : 1 - Math.exp(-seconds * 8);
    this.shown += (this.inset - this.shown) * ease;
    if (Math.abs(this.shown - this.fitted.inset) > 0.25) this.fit();
  }

  /** The lid eases toward open while a sellable creature is held over the box, and cracks open while anything is carried. */
  private poseArchive(seconds: number) {
    const drag = this.drag?.moved ? this.drag : null;
    const over = drag?.spot?.kind === "archive";
    const price = drag ? this.options.sellPrice(drag.id) : null;
    const target = over && price !== null ? 1 : drag ? 0.12 : 0;
    this.open += (target - this.open) * (this.options.reduced ? 1 : 1 - Math.exp(-seconds * (target > this.open ? 16 : 9)));
    const { lid, light, inside } = this.archive;
    lid.rotation.x = -this.open * 1.95;
    light.intensity = this.open * 2.6;
    inside.opacity = this.open * 0.75;
    this.refund.toggleAttribute("data-shown", over);
  }

  // --- the frame around it ---

  private resize() {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    this.renderer.setSize(width, height, false);
    const upright = width < height;
    if (upright !== this.upright) {
      this.upright = upright;
      this.post();
    }
    this.fit();
  }

  /**
   * Frames the board, the Drafts and the Archive in the part of the screen nothing
   * covers: below the top bar, above the shop. The scene is drawn as part of a taller
   * picture whose middle is that free band, so the shop can rise and fall over it and
   * the camera dollies to keep everything in view.
   */
  private fit() {
    const { clientWidth: width, clientHeight: height } = this.host;
    if (!width || !height) return;
    const { box, pitch, steepest, fov, top } = this.upright ? UPRIGHT_FRAME : WIDE_FRAME;
    const full = Math.max(1, height + this.shown - top);
    const free = Math.max(0.2, (height - this.shown - top) / full);
    for (const camera of [this.camera, this.probe]) {
      camera.fov = fov;
      camera.aspect = width / full;
    }
    this.probe.updateProjectionMatrix();
    // A band taller than the scene is wide leaves floor showing under it: look down more steeply, which draws the board's depth longer, until the height is used too.
    let shallow = pitch;
    let steep = steepest;
    let view = this.viewAt(box, pitch, free);
    for (let step = 0; steep - shallow > 0.01 && step < 10; step += 1) {
      const middle = (shallow + steep) / 2;
      const tried = this.viewAt(box, middle, free);
      const slack = tried.high - tried.low < 2 * free * FIT_MARGIN * 0.97;
      if (slack) {
        shallow = middle;
        view = tried;
      } else steep = middle;
    }
    this.aim.copy(view.aim);
    this.eye.copy(view.aim).addScaledVector(view.direction, view.distance);
    // The fog starts behind the board wherever the camera stands, so a phone's farther camera never dims the play area; only the city fades.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = view.distance + 6;
    fog.far = view.distance + 26;
    this.camera.setViewOffset(width, full, 0, this.shown - top, width, height);
    this.fitted = { inset: this.shown, width, height };
  }

  /** The camera looking down at `pitch`, as near as it can stand with the box in the band, aimed so the box's near and far ends sit evenly. */
  private viewAt(box: THREE.Box3, pitch: number, free: number) {
    const direction = new THREE.Vector3(0, Math.sin(pitch), Math.cos(pitch));
    const aim = box.getCenter(new THREE.Vector3()).setY(0.3);
    for (let pass = 0; pass < 4; pass += 1) {
      const [low, high] = this.spread(box, aim, direction, this.distanceToFit(box, aim, direction, free));
      aim.z -= ((low + high) / 2 / Math.max(0.01, high - low)) * (box.max.z - box.min.z);
    }
    const distance = this.distanceToFit(box, aim, direction, free);
    const [low, high] = this.spread(box, aim, direction, distance);
    return { aim, direction, distance, low, high };
  }

  /** The nearest distance from `aim` along `direction` at which every corner of `box` lands inside the free band. */
  private distanceToFit(box: THREE.Box3, aim: THREE.Vector3, direction: THREE.Vector3, free: number): number {
    let near = 2;
    let far = 90;
    for (let step = 0; step < 22; step += 1) {
      const middle = (near + far) / 2;
      const [low, high, side] = this.spread(box, aim, direction, middle);
      if (side <= FIT_MARGIN && high <= free * FIT_MARGIN && low >= -free * FIT_MARGIN) far = middle;
      else near = middle;
    }
    return far;
  }

  /** Where the box's corners land seen from `distance`: the lowest and highest, and the widest to either side. */
  private spread(box: THREE.Box3, aim: THREE.Vector3, direction: THREE.Vector3, distance: number): [number, number, number] {
    this.probe.position.copy(aim).addScaledVector(direction, distance);
    this.probe.lookAt(aim);
    this.probe.updateMatrixWorld();
    let low = Infinity;
    let high = -Infinity;
    let side = 0;
    const corner = new THREE.Vector3();
    for (let index = 0; index < 8; index += 1) {
      corner.set(index & 1 ? box.max.x : box.min.x, index & 2 ? box.max.y : box.min.y, index & 4 ? box.max.z : box.min.z).project(this.probe);
      low = Math.min(low, corner.y);
      high = Math.max(high, corner.y);
      side = Math.max(side, Math.abs(corner.x));
    }
    return [low, high, side];
  }

  private ray(event: Point) {
    const box = this.renderer.domElement.getBoundingClientRect();
    this.raycaster.setFromCamera(new THREE.Vector2(((event.clientX - box.left) / box.width) * 2 - 1, -((event.clientY - box.top) / box.height) * 2 + 1), this.camera);
  }

  private actorUnder(event: PointerEvent): string | null {
    this.ray(event);
    const standing = [...this.actors.values()].filter((actor) => !actor.out);
    const badges = standing.flatMap((actor) => (actor.badge.visible && actor.bar.visible ? [actor.badge] : []));
    const [hit] = this.raycaster.intersectObjects([...standing.map((actor) => actor.creature.root), ...badges], true);
    return (hit?.object.userData.actor as string | undefined) ?? null;
  }

  private cellUnder(event: Point): { x: number; y: number } | null {
    this.ray(event);
    const point = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.ground, point)) return null;
    const x = Math.round(point.x / CELL + (COLS - 1) / 2);
    const y = Math.round(ROWS - 0.5 - point.z / CELL);
    return x >= 0 && x < COLS && y >= 0 && y < ROWS * 2 ? { x, y } : null;
  }

  /** Where a carried creature would land under a point: an own cell, a Drafts slot, or nowhere. */
  private spotUnder(event: Point): Spot | null {
    this.ray(event);
    const point = new THREE.Vector3();
    if (this.raycaster.intersectObject(this.archive.root, true).length > 0) return { kind: "archive" };
    if (!this.raycaster.ray.intersectPlane(this.ground, point)) return null;
    const box = this.archive.root.position;
    if (Math.abs(point.x - box.x) < ARCHIVE_WIDTH * 0.7 && Math.abs(point.z - box.z) < ARCHIVE_DEPTH * 0.8) return { kind: "archive" };
    if (Math.abs(point.z - BENCH_Z) < BENCH_DEPTH / 2 + 0.1) {
      const slot = Math.round((point.x - BENCH_X) / BENCH_PITCH + (BENCH_SIZE - 1) / 2);
      return slot >= 0 && slot < BENCH_SIZE ? { kind: "bench", slot } : null;
    }
    const cell = this.cellUnder(event);
    return cell && cell.y < ROWS ? { kind: "cell", col: cell.x, row: ROWS - 1 - cell.y } : null;
  }

  /**
   * Lights the spot a carried creature would land on, and, softly, every other spot it
   * may land on: free Drafts slots, and the player's cells (a free one only while the
   * board has room for a creature from the Drafts).
   */
  private light(carried: Actor | null, spot: Spot | null) {
    const fromBench = carried?.unit.bench !== undefined;
    const taken = new Set([...this.actors.values()].filter((actor) => actor.unit.side === 0 && actor.unit.bench === undefined).map((actor) => `${actor.unit.x},${actor.unit.y}`));
    const shelved = new Set([...this.actors.values()].flatMap((actor) => (actor.unit.side === 0 && actor.unit.bench !== undefined ? [actor.unit.bench] : [])));
    for (const mesh of this.cells) {
      const material = mesh.material as THREE.MeshToonMaterial;
      const { x, y } = mesh.userData as { x: number; y: number };
      const on = spot?.kind === "cell" && y < ROWS && spot.col === x && ROWS - 1 - spot.row === y;
      const legal = carried !== null && y < ROWS && (taken.has(`${x},${y}`) || !fromBench || this.room > 0);
      material.color.setHex(on ? 0x35c450 : (mesh.userData.colour as number));
      material.emissive.setHex(legal && !on ? LEGAL : 0x000000);
    }
    for (const mesh of this.slots) {
      const material = mesh.material as THREE.MeshToonMaterial;
      const slot = mesh.userData.slot as number;
      const on = spot?.kind === "bench" && spot.slot === slot;
      material.color.setHex(on ? DRAFT_LIT : (mesh.userData.colour as number));
      material.emissive.setHex(carried !== null && !on && !shelved.has(slot) ? 0x1a1f26 : 0x000000);
    }
  }

  /** The refund beside the held creature: "+3" in gold, or why it can't be sold. */
  private showRefund(id: string, at: Point) {
    const price = this.options.sellPrice(id);
    const box = this.host.getBoundingClientRect();
    this.refund.textContent = price === null ? "Can't sell" : `+${price}`;
    this.refund.dataset.kind = price === null ? "refused" : "refund";
    this.refund.style.left = `${at.clientX - box.left + 34}px`;
    this.refund.style.top = `${at.clientY - box.top - 46}px`;
  }

  private down = (event: PointerEvent) => {
    const id = this.actorUnder(event);
    // In a fight a tap only picks a creature to look at: nothing is carried, and the fight plays on.
    if (this.fight && !this.fight.done) return this.options.onSelect(id);
    if (!id) return this.options.onSelect(null);
    this.drag = { id, startX: event.clientX, startY: event.clientY, moved: false, spot: null };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private move = (event: PointerEvent) => {
    const drag = this.drag;
    if (!drag) {
      const fighting = this.fight !== null && !this.fight.done;
      this.renderer.domElement.style.cursor = this.actorUnder(event) ? (fighting ? "pointer" : "grab") : "";
      return;
    }
    const actor = this.actors.get(drag.id);
    // Only the player's own creatures can be carried.
    if (!actor || actor.unit.side !== 0 || this.fight) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 8) return;
    if (!drag.moved) this.options.onDrag(drag.id);
    drag.moved = true;
    this.renderer.domElement.style.cursor = "grabbing";
    const point = new THREE.Vector3();
    this.ray(event);
    if (this.raycaster.ray.intersectPlane(this.ground, point)) actor.at.set(point.x, 0.1, point.z);
    drag.spot = this.spotUnder(event);
    this.light(actor, drag.spot);
    // Over the Archive the creature hangs above the open box, ready to drop in.
    if (drag.spot?.kind === "archive") {
      actor.at.copy(this.archive.root.position).setY(0.1);
      this.showRefund(drag.id, event);
    }
  };

  private up = (event: PointerEvent) => {
    const drag = this.drag;
    this.drag = null;
    this.light(null, null);
    this.renderer.domElement.style.cursor = "";
    if (!drag) return;
    if (!drag.moved) return this.options.onSelect(drag.id);
    this.options.onDrag(null);
    const actor = this.actors.get(drag.id);
    // Put down: a short squash, the way something lands.
    if (actor) actor.squash = 0.22;
    const spot = this.spotUnder(event);
    if (spot?.kind === "archive" && this.options.sellPrice(drag.id) !== null) this.archiving = drag.id;
    if (spot) this.options.onMove(drag.id, spot);
  };
}

/** The gif look's condition badge: the condition's word on a pill of its colour. */
function wordTexture(condition: Condition): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const pen = canvas.getContext("2d")!;
  pen.fillStyle = CONDITION_COLOR[condition];
  pen.beginPath();
  pen.roundRect(4, 6, 248, 52, 26);
  pen.fill();
  pen.fillStyle = "#0b0f14";
  pen.font = "700 30px system-ui, sans-serif";
  pen.textAlign = "center";
  pen.textBaseline = "middle";
  pen.fillText(CONDITION_NAMES[condition], 128, 33);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
