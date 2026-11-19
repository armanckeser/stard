import * as THREE from "three";
import { INK, toon } from "./kit";
import type { Creature } from "./creature";

// Every creature on the board in three draws, however many stand there: one for the
// lit parts, one for the unlit ones and one for every outline, plus one in the shadow
// pass. A creature is built as a dozen parts, each with an outline, and drawn one by one
// that was ~600 draws a frame, more than a phone can keep up with at 60 fps.
//
// The creature keeps its parts as they are, so everything that poses it (breath, blink,
// swing, spin, lunge) and the pointer's raycast work unchanged; the parts are only hidden
// from the renderer, and each frame copies every part's place into the batch.

/** Room the batches start with: about sixteen creatures. They grow when a board needs more. */
const START_INSTANCES = 512;
const START_VERTICES = 120_000;

type Piece = { batch: Batch; geometryId: number; instanceId: number; source: THREE.Object3D };
type Member = { creature: Creature; pieces: Piece[]; flash: number };

/** A BatchedMesh that grows instead of throwing when it runs out of room. */
class Batch {
  mesh: THREE.BatchedMesh;
  private instances = START_INSTANCES;
  private vertices = START_VERTICES;
  private indices = START_VERTICES * 3;
  /** Set once a creature has left: the space it held is reclaimed before the next one is added. */
  private holes = false;

  constructor(material: THREE.Material, shadow: boolean) {
    this.mesh = new THREE.BatchedMesh(this.instances, this.vertices, this.indices, material);
    this.mesh.castShadow = shadow;
    // Everything stands on screen and is opaque: culling and sorting each part per frame costs more than it saves.
    this.mesh.frustumCulled = false;
    this.mesh.perObjectFrustumCulled = false;
    this.mesh.sortObjects = false;
  }

  add(geometry: THREE.BufferGeometry): { geometryId: number; instanceId: number } {
    const vertices = geometry.getAttribute("position").count;
    const indices = geometry.getIndex()!.count;
    if (this.holes && (this.mesh.unusedVertexCount < vertices || this.mesh.unusedIndexCount < indices)) {
      this.mesh.optimize();
      this.holes = false;
    }
    if (this.mesh.unusedVertexCount < vertices || this.mesh.unusedIndexCount < indices) {
      this.vertices = Math.max(this.vertices * 2, this.vertices + vertices);
      this.indices = Math.max(this.indices * 2, this.indices + indices);
      this.mesh.setGeometrySize(this.vertices, this.indices);
    }
    if (this.mesh.instanceCount >= this.instances) {
      this.instances *= 2;
      this.mesh.setInstanceCount(this.instances);
    }
    const geometryId = this.mesh.addGeometry(geometry);
    return { geometryId, instanceId: this.mesh.addInstance(geometryId) };
  }

  remove(piece: Piece) {
    this.mesh.deleteInstance(piece.instanceId);
    this.mesh.deleteGeometry(piece.geometryId);
    this.holes = true;
  }
}

/**
 * The part's shape with its paint in every vertex, in the one layout a batch takes:
 * indexed, with a position, a normal and a colour and nothing else.
 */
function painted(geometry: THREE.BufferGeometry, paint: THREE.Color | null): THREE.BufferGeometry {
  const copy = new THREE.BufferGeometry();
  const position = geometry.getAttribute("position");
  copy.setAttribute("position", position.clone());
  copy.setAttribute("normal", (geometry.getAttribute("normal") ?? position).clone());
  const own = geometry.getAttribute("color");
  if (own) copy.setAttribute("color", own.clone());
  else {
    const colors = new Float32Array(position.count * 3);
    const color = paint ?? new THREE.Color(1, 1, 1);
    for (let i = 0; i < position.count; i++) color.toArray(colors, i * 3);
    copy.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }
  copy.setIndex(geometry.getIndex()?.clone() ?? [...Array(position.count).keys()]);
  return copy;
}

/**
 * The lit parts' material: the toon bands, the paint from the vertex, and the batch's
 * per-part colour turned into a white glow added on top, which is how a hit flashes the
 * creature (it used to be each paint material's emissive).
 */
function litMaterial(): THREE.MeshToonMaterial {
  const material = toon("#ffffff");
  material.vertexColors = true;
  material.side = THREE.DoubleSide;
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <color_pars_vertex>", "#include <color_pars_vertex>\nvarying float vFlash;")
      .replace("vColor.xyz *= batchingColor.xyz;", "vFlash = batchingColor.x;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <color_pars_fragment>", "#include <color_pars_fragment>\nvarying float vFlash;")
      .replace("#include <emissivemap_fragment>", "#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3( vFlash );");
  };
  material.customProgramCacheKey = () => "crowd-lit";
  return material;
}

const white = new THREE.Color();

export class Crowd {
  private lit = new Batch(litMaterial(), true);
  private flat = new Batch(new THREE.MeshBasicMaterial({ vertexColors: true }), true);
  private ink = new Batch(new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide }), false);
  private members = new Map<Creature, Member>();
  readonly root = new THREE.Group();

  constructor() {
    this.root.add(this.lit.mesh, this.flat.mesh, this.ink.mesh);
    // Turns the lit batch's colour texture on, at no glow, so its shader is built with it from the start.
    const { instanceId } = this.lit.add(painted(new THREE.BoxGeometry(0, 0, 0), null));
    this.lit.mesh.setColorAt(instanceId, white.setScalar(0));
    this.lit.mesh.setVisibleAt(instanceId, false);
  }

  dispose() {
    for (const batch of [this.lit, this.flat, this.ink]) batch.mesh.dispose();
  }

  /** Takes over drawing `creature`; its own meshes stay for posing and picking, hidden. */
  add(creature: Creature) {
    const pieces: Piece[] = [];
    creature.root.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshBasicMaterial | THREE.MeshToonMaterial;
      const rim = mesh.userData.rim === true;
      const batch = rim ? this.ink : (material as THREE.MeshToonMaterial).isMeshToonMaterial ? this.lit : this.flat;
      // The sash already carries its colours in its vertices, on a white material.
      const paint = rim ? null : material.vertexColors ? null : material.color.clone();
      const { geometryId, instanceId } = batch.add(painted(mesh.geometry, paint));
      if (batch === this.lit) this.lit.mesh.setColorAt(instanceId, white.setScalar(0));
      pieces.push({ batch, geometryId, instanceId, source: mesh });
    });
    creature.root.traverse((node) => {
      if ((node as THREE.Mesh).isMesh) node.visible = false;
    });
    this.members.set(creature, { creature, pieces, flash: 0 });
  }

  remove(creature: Creature) {
    const member = this.members.get(creature);
    if (!member) return;
    for (const piece of member.pieces) piece.batch.remove(piece);
    this.members.delete(creature);
  }

  /** How bright the creature's hit flash is, 0 to 1 of the glow; the next `sync` draws it. */
  flash(creature: Creature, glow: number) {
    const member = this.members.get(creature);
    if (member) member.flash = glow;
  }

  /** Copies every part's place, and whether its creature shows, into the batches. Call after posing, before rendering. */
  sync() {
    for (const { creature, pieces, flash } of this.members.values()) {
      creature.root.updateMatrixWorld(true);
      const shown = creature.root.visible && creature.root.parent !== null;
      for (const piece of pieces) {
        piece.batch.mesh.setVisibleAt(piece.instanceId, shown);
        if (!shown) continue;
        piece.batch.mesh.setMatrixAt(piece.instanceId, piece.source.matrixWorld);
        if (piece.batch === this.lit) piece.batch.mesh.setColorAt(piece.instanceId, white.setScalar(flash));
      }
    }
  }
}
