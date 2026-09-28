/**
 * three.js side of the body: materials per layer, see-through, highlight, and posing bones by name.
 * View code (imports three). The math it calls lives in src/core/.
 */
import * as THREE from 'three';
import { helperPose, type BonePoses, type Helper, type JointMap } from '../core/jointmap';
import { LANDMARKS } from '../core/landmarks';
import type { RigidTransform } from '../core/fk';

export const COLORS = {
  bone: new THREE.Color('#e9dfcf'),
  muscles: new THREE.Color('#b9634f'),
  skin: new THREE.Color('#dcc0a8'),
  connective: new THREE.Color('#d8cab0'),
} as const;

/**
 * One hue per highlighted structure, so neighbours (rhomboids, middle trapezius) don't merge into one
 * blob. Picked to read on see-through red-brown muscle and cream bone, and to stay apart for the
 * common kinds of colour blindness (blue / amber / bluish green / sky differ in hue *and* lightness).
 * The chips under the body use the same list, in the same order.
 */
export const HIGHLIGHT_HEX = ['#44679b', '#e0a31c', '#1f9e89', '#7cc4f0'] as const;
const HIGHLIGHT = HIGHLIGHT_HEX.map((h) => new THREE.Color(h));

/** za_name → palette index, in the order the exercise lists them. Repeats wrap around. */
export function highlightColors(names: readonly string[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const n of names) if (!m.has(n)) m.set(n, m.size % HIGHLIGHT_HEX.length);
  return m;
}

export interface Structure {
  zaName: string;
  layer: string;
  mesh: THREE.Mesh;
  material: THREE.MeshStandardMaterial;
}

/** Nearest `extras.za_*` on the object or its ancestors (gltfpack moves meshes under a named parent). */
function extrasOf(o: THREE.Object3D, stop: THREE.Object3D): { za_name?: string; za_layer?: string } {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    if (typeof p.userData.za_name === 'string') return p.userData as { za_name: string; za_layer?: string };
    if (p === stop) break;
  }
  return {};
}

/** Give every structure its own calm material. `fallbackLayer` is used when the file has no `za_layer`. */
export function collectStructures(root: THREE.Object3D, fallbackLayer: string): Structure[] {
  const out: Structure[] = [];
  root.traverse((o) => {
    if (!(o as THREE.Mesh).isMesh) return;
    const mesh = o as THREE.Mesh;
    const ex = extrasOf(mesh, root);
    const layer = ex.za_layer ?? fallbackLayer;
    const base = layer === 'skeleton' || layer === 'bones' ? COLORS.bone : (COLORS as Record<string, THREE.Color>)[layer] ?? COLORS.muscles;
    const material = new THREE.MeshStandardMaterial({ color: base.clone(), roughness: 0.78, metalness: 0 });
    material.userData.base = base;
    mesh.material = material;
    mesh.frustumCulled = false; // skinned meshes move outside their rest bounds
    out.push({ zaName: ex.za_name ?? mesh.userData.name ?? mesh.name, layer, mesh, material });
  });
  return out;
}

const BLACK = new THREE.Color(0x000000);

export interface Look {
  /** Layer → 0..1. */
  opacity: Record<string, number>;
  /** za_name → index into HIGHLIGHT_HEX (see highlightColors). */
  highlight: ReadonlyMap<string, number>;
  /** Highlights stay visible through faded layers. */
  showHighlight: boolean;
}

export function styleStructures(list: Structure[], look: Look): void {
  for (const s of list) {
    const hue = look.showHighlight ? look.highlight.get(s.zaName) : undefined;
    const lit = hue !== undefined;
    const color = lit ? HIGHLIGHT[hue]! : null;
    const layerOpacity = look.opacity[s.layer] ?? 1;
    const opacity = lit ? Math.max(layerOpacity, 0.9) : layerOpacity;
    const m = s.material;
    m.color.copy(color ?? (m.userData.base as THREE.Color));
    m.emissive.copy(color ?? BLACK);
    m.emissiveIntensity = lit ? 0.4 : 0;
    m.opacity = opacity;
    m.transparent = opacity < 0.999;
    m.depthWrite = opacity >= 0.999;
    m.needsUpdate = true;
    s.mesh.visible = opacity > 0.01;
    s.mesh.renderOrder = lit ? 2 : m.transparent ? 1 : 0;
  }
}

/** Every copy of each named bone across the loaded files, with its REST pose. */
export interface Rig {
  copies: Map<string, THREE.Object3D[]>;
  restLocal: Map<THREE.Object3D, THREE.Quaternion>;
  restPosition: Map<THREE.Object3D, THREE.Vector3>;
  restScale: Map<THREE.Object3D, THREE.Vector3>;
  /** Stretch helpers ("bands") per loaded copy, with their REST length measured at load. */
  helpers: BoundHelper[];
  roots: THREE.Object3D[];
}

interface BoundHelper {
  spec: Helper;
  bone: THREE.Object3D;
  parent: THREE.Object3D;
  target: THREE.Object3D;
  restLength: number;
}

/**
 * Bind by the original glTF node name (`userData.name`): three.js sanitizes `.name`
 * (`Scapula.r` → `Scapular`). Each GLB carries the same joint list, so posing every copy
 * the same way acts as one shared skeleton. Call with the files at REST (as loaded).
 */
export function bindRig(roots: THREE.Object3D[], boneNames: Iterable<string>, helpers: Helper[] = []): Rig {
  const wanted = new Set(boneNames);
  const rig: Rig = { copies: new Map(), restLocal: new Map(), restPosition: new Map(), restScale: new Map(), helpers: [], roots };
  for (const root of roots) {
    root.updateMatrixWorld(true);
    const byName = new Map<string, THREE.Object3D>();
    root.traverse((o) => {
      const n = o.userData.name as string | undefined;
      if (!n || !wanted.has(n) || byName.has(n)) return;
      byName.set(n, o);
      const list = rig.copies.get(n) ?? [];
      list.push(o);
      rig.copies.set(n, list);
      rig.restLocal.set(o, o.quaternion.clone());
      rig.restPosition.set(o, o.position.clone());
      rig.restScale.set(o, o.scale.clone());
    });
    for (const h of helpers) {
      const bone = byName.get(h.bone), parent = byName.get(h.parent), target = byName.get(h.target);
      if (!bone || !parent || !target) continue;
      const head = bone.getWorldPosition(new THREE.Vector3());
      const restLength = head.distanceTo(target.getWorldPosition(new THREE.Vector3()));
      rig.helpers.push({ spec: h, bone, parent, target, restLength });
    }
  }
  return rig;
}

const dq = new THREE.Quaternion();
const pPos = new THREE.Vector3();
const pQuat = new THREE.Quaternion();
const pScale = new THREE.Vector3();
const tPos = new THREE.Vector3();

/** REST · delta for every bone the pose touches; bones it doesn't touch go back to REST. Then the helpers. */
export function applyPose(rig: Rig, poses: BonePoses): void {
  for (const [name, copies] of rig.copies) {
    const bp = poses.bones[name];
    for (const o of copies) {
      const rest = rig.restLocal.get(o)!;
      o.position.copy(rig.restPosition.get(o)!);
      o.scale.copy(rig.restScale.get(o)!);
      if (!bp) {
        o.quaternion.copy(rest);
        continue;
      }
      dq.set(bp.quaternion[0], bp.quaternion[1], bp.quaternion[2], bp.quaternion[3]);
      o.quaternion.copy(rest).multiply(dq);
    }
  }
  if (!rig.helpers.length) return;
  // Parents too: the holder may have just been placed (place()) and not rendered yet. With a stale
  // holder matrix, the helper's parent (read from matrixWorld) and its target (getWorldPosition,
  // which refreshes the parents) land in different frames, and the bands shoot off as spikes
  // whenever the body is turned (lying, all fours).
  for (const r of rig.roots) r.updateWorldMatrix(true, true);
  for (const h of rig.helpers) {
    h.parent.matrixWorld.decompose(pPos, pQuat, pScale);
    h.target.getWorldPosition(tPos);
    const rp = rig.restPosition.get(h.bone)!;
    const rq = rig.restLocal.get(h.bone)!;
    const out = helperPose(
      { position: [pPos.x, pPos.y, pPos.z], quaternion: [pQuat.x, pQuat.y, pQuat.z, pQuat.w], scale: pScale.x },
      { position: [rp.x, rp.y, rp.z], quaternion: [rq.x, rq.y, rq.z, rq.w] },
      [tPos.x, tPos.y, tPos.z],
      h.restLength,
      h.spec.stretch_axis_three,
      h.spec.volume_axis_three,
    );
    h.bone.quaternion.set(out.quaternion[0], out.quaternion[1], out.quaternion[2], out.quaternion[3]);
    h.bone.scale.set(out.scale[0], out.scale[1], out.scale[2]);
  }
}

// ---------------------------------------------------------------- one rig per loaded file

/** REST world matrices of every named node in the skeleton file, for landmarks. */
interface RestFrames {
  byName: Map<string, THREE.Object3D>;
  restWorldInv: Map<THREE.Object3D, THREE.Matrix4>;
}
const rigs = new WeakMap<THREE.Object3D, Rig>();
const rests = new WeakMap<Rig, RestFrames>();

/**
 * `bindRig` records REST from the objects as they are, and the loader caches scenes across remounts
 * (going back to the shelf and into another move). Bind once per loaded scene so REST stays REST.
 * Call while the files are at REST and their holder is untransformed.
 */
export function bindRigOnce(roots: THREE.Object3D[], boneNames: Iterable<string>, helpers: Helper[] = []): Rig {
  const hit = rigs.get(roots[0]!);
  if (hit && hit.roots.length === roots.length && hit.roots.every((r, i) => r === roots[i])) return hit;
  const rig = bindRig(roots, boneNames, helpers);
  rigs.set(roots[0]!, rig);
  const rf: RestFrames = { byName: new Map(), restWorldInv: new Map() };
  roots[0]!.updateMatrixWorld(true);
  roots[0]!.traverse((o) => {
    const n = o.userData.name as string | undefined;
    if (!n || rf.byName.has(n)) return;
    rf.byName.set(n, o);
    rf.restWorldInv.set(o, o.matrixWorld.clone().invert());
  });
  rests.set(rig, rf);
  return rig;
}

const b2t = (v: readonly number[]) => new THREE.Vector3(v[0], v[2], -v[1]!);

/**
 * World position of a landmark (core/landmarks.ts) on the drawn body: its REST spot, carried by its
 * three.js bone. Props are placed by core (ground.ts), so the page doesn't need this; body.test.ts
 * uses it to hold the drawn body to core's `landmark()` (they agree to well under 2 mm).
 */
export function landmarkWorld(rig: Rig, jm: JointMap, name: string): THREE.Vector3 | null {
  const def = LANDMARKS[name];
  const rf = rests.get(rig);
  if (!def || !rf) return null;
  const bone = rf.byName.get(def.bone);
  const inv = bone && rf.restWorldInv.get(bone);
  if (!bone || !inv) return null;
  const br = jm.bones[def.bone];
  const head = br?.head ? b2t(br.head) : new THREE.Vector3().setFromMatrixPosition(inv.clone().invert());
  const tail = br?.tail ? b2t(br.tail) : head.clone();
  const rest = head.lerp(tail, def.at).add(new THREE.Vector3(...def.offset));
  return rest.applyMatrix4(inv).applyMatrix4(bone.matrixWorld);
}

// ---------------------------------------------------------------- framing

/** Put the holder of the GLBs where core's groundPose says (`g.transform`), or back at the origin. */
export function place(holder: THREE.Object3D, t: RigidTransform | null): void {
  if (t) {
    holder.position.set(t.position[0], t.position[1], t.position[2]);
    holder.quaternion.set(t.quaternion[0], t.quaternion[1], t.quaternion[2], t.quaternion[3]);
  } else {
    holder.position.set(0, 0, 0);
    holder.quaternion.identity();
  }
}

/** One moment of the move, as core grounded it. */
export interface MeasureSample {
  bones: BonePoses;
  transform: RigidTransform | null;
}

const meshBox = new THREE.Box3();

/**
 * World box around the body over a few poses (the move's key moments), so the camera can frame the
 * whole move once instead of chasing it. `only` limits the box to some structures (the highlights).
 * Leaves the rig in the last pose; the caller re-applies the current one.
 */
export function measurePoses(
  rig: Rig,
  holder: THREE.Object3D,
  structures: readonly Structure[],
  samples: readonly MeasureSample[],
  only?: ReadonlySet<string>,
): THREE.Box3 {
  const box = new THREE.Box3();
  const list = only?.size ? structures.filter((s) => only.has(s.zaName)) : structures;
  for (const s of samples) {
    place(holder, s.transform);
    applyPose(rig, s.bones);
    holder.updateMatrixWorld(true);
    for (const st of list) {
      const m = st.mesh as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) m.computeBoundingBox();
      else if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const b = m.isSkinnedMesh ? m.boundingBox : m.geometry.boundingBox;
      if (!b || b.isEmpty()) continue;
      box.union(meshBox.copy(b).applyMatrix4(m.matrixWorld));
    }
  }
  return box;
}
