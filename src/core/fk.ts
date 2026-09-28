/**
 * Forward kinematics: joint-map bones + a pose + a root → where every bone and landmark is.
 *
 * Works in three.js space (+Y up, the body faces +Z, the subject's left is +X), in two steps:
 * 1. **Model space.** The rig as loaded, posed: each bone's world rotation is
 *    `W = W_parent · (W_parent_rest⁻¹ · W_rest) · delta`, and its head rides on the parent's frame from
 *    where it sat at REST. This is what Blender and three.js both do with full inheritance, so it
 *    matches the pipeline's probe poses to a few microns (fk.test.ts).
 * 2. **World space.** The root puts the pelvis (the root bone's head) at `root.position` and turns
 *    the whole body by `root.orientation` about it. `modelTransform` gives the matching
 *    position/quaternion for the group that holds the loaded GLBs.
 *
 * joint-map.json stores rest heads, tails and axes in Blender space; `restFrames` converts them once
 * with C: (x, y, z) → (x, z, -y). Bone-local frames need no conversion (see anatomy-pipeline.md).
 */

import type { Orientation, Root } from './exercise';
import type { BonePoses, JointMap } from './jointmap';
import { LANDMARKS } from './landmarks';
import {
  type Quat, type Vec3, IDENTITY, add, conj, fromAxisAngle, fromBasis, lerp3, mul, normalize, rotate, sub,
} from './quat';

const DEG = Math.PI / 180;

/** Blender armature space → three.js. */
export const toThree = (v: Vec3): [number, number, number] => [v[0], v[2], -v[1]];

export interface RestBone {
  name: string;
  parent: string | null;
  /** three.js model space, metres. */
  head: Vec3;
  tail: Vec3;
  /** World rotation of the bone's local frame at REST. */
  quaternion: Quat;
}

export interface RestFrames {
  bones: Map<string, RestBone>;
  /** Parents before children. */
  order: string[];
  /** The bone the body hangs from (`Hips`). */
  root: string;
}

const restCache = new WeakMap<JointMap, RestFrames>();

/** The rig at REST in three.js space. Cached per map object. Throws if a bone lacks rest data. */
export function restFrames(map: JointMap): RestFrames {
  const hit = restCache.get(map);
  if (hit) return hit;
  const bones = new Map<string, RestBone>();
  for (const [name, b] of Object.entries(map.bones)) {
    if (!b.head || !b.tail || !b.rest_axes)
      throw new Error(`fk: bone ${name} has no head/tail/rest_axes (re-run the pipeline's joints.py)`);
    const ax = b.rest_axes;
    bones.set(name, {
      name,
      parent: b.parent,
      head: toThree(b.head),
      tail: toThree(b.tail),
      quaternion: fromBasis(toThree(ax.x), toThree(ax.y), toThree(ax.z)),
    });
  }
  const order: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, depth: number) => {
    if (seen.has(n)) return;
    if (depth > bones.size) throw new Error(`fk: parent loop at ${n}`);
    const p = bones.get(n)!.parent;
    if (p !== null) {
      if (!bones.has(p)) throw new Error(`fk: bone ${n} has unknown parent ${p}`);
      visit(p, depth + 1);
    }
    seen.add(n);
    order.push(n);
  };
  for (const n of bones.keys()) visit(n, 0);
  const pelvis = map.joints.pelvis?.bone;
  const root = map.trunk_chain?.[0] ?? (pelvis && bones.has(pelvis) ? pelvis : order[0]!);
  const frames: RestFrames = { bones, order, root };
  restCache.set(map, frames);
  return frames;
}

// ---------------------------------------------------------------- root

/** World rotation for a root orientation: yaw · pitch · roll (see exercise.ts `Orientation`). */
export function orientationQuat(o: Orientation): Quat {
  const yaw = fromAxisAngle('y', -(o.yaw ?? 0) * DEG); // + turns the front (+Z) toward the subject's right (-X)
  const pitch = fromAxisAngle('x', (o.pitch ?? 0) * DEG); // + tips the head (+Y) toward the front (+Z)
  const roll = fromAxisAngle('z', (o.roll ?? 0) * DEG); // + tips the head toward the subject's right (-X)
  return normalize(mul(yaw, mul(pitch, roll)));
}

export interface RigidTransform {
  position: Vec3;
  quaternion: Quat;
}

/**
 * Transform for the group holding the loaded GLBs so the pelvis lands at `root.position`, turned by
 * `root.orientation`: `world = position + quaternion · model`. In the app:
 * `group.position.set(...t.position); group.quaternion.set(...t.quaternion)`.
 */
export function modelTransform(root: Root, map: JointMap): RigidTransform {
  const rf = restFrames(map);
  const q = orientationQuat(root.orientation);
  const pelvis = rf.bones.get(rf.root)!.head;
  return { position: sub(root.position, rotate(q, pelvis)), quaternion: q };
}

export const applyTransform = (t: RigidTransform, p: Vec3): [number, number, number] => add(t.position, rotate(t.quaternion, p));
export const invertTransform = (t: RigidTransform, p: Vec3): [number, number, number] =>
  rotate(conj(t.quaternion), sub(p, t.position));

// ---------------------------------------------------------------- posing

export interface PosedBone {
  head: Vec3;
  tail: Vec3;
  /** World rotation of the bone's local frame. */
  quaternion: Quat;
}

export interface Posed {
  /** Every bone, world space (model space when no root was given). */
  bones: Map<string, PosedBone>;
  transform: RigidTransform;
  rest: RestFrames;
  /** Where a point that sat at `restPoint` (three.js REST model space) on `bone` is now. */
  pointOn(bone: string, restPoint: Vec3): [number, number, number];
}

/**
 * Pose the rig. `poses` is toBonePoses' output (delta rotations per bone, relative to REST); bones it
 * doesn't name stay at REST. With a `root`, results are in world space; without, in model space.
 */
export function forwardKinematics(map: JointMap, poses: Pick<BonePoses, 'bones'>, root?: Root): Posed {
  const rf = restFrames(map);
  const deltas = poses.bones;
  const transform: RigidTransform = root ? modelTransform(root, map) : { position: [0, 0, 0], quaternion: IDENTITY };
  const out = new Map<string, PosedBone>();
  // Per bone: world rotation, and the "carry" rotation W · W_rest⁻¹ that moves rest-space offsets.
  const carry = new Map<string, Quat>();
  for (const name of rf.order) {
    const rb = rf.bones.get(name)!;
    const d = deltas[name]?.quaternion ?? IDENTITY;
    let head: Vec3;
    let w: Quat;
    if (rb.parent === null) {
      w = mul(transform.quaternion, mul(rb.quaternion, d));
      head = applyTransform(transform, rb.head);
    } else {
      const pr = rf.bones.get(rb.parent)!;
      const pp = out.get(rb.parent)!;
      const pc = carry.get(rb.parent)!;
      head = add(pp.head, rotate(pc, sub(rb.head, pr.head)));
      w = mul(pc, mul(rb.quaternion, d));
    }
    w = normalize(w);
    const c = mul(w, conj(rb.quaternion));
    carry.set(name, c);
    out.set(name, { head, tail: add(head, rotate(c, sub(rb.tail, rb.head))), quaternion: w });
  }
  return {
    bones: out,
    transform,
    rest: rf,
    pointOn(bone, restPoint) {
      const rb = rf.bones.get(bone);
      const pb = out.get(bone);
      if (!rb || !pb) throw new Error(`fk: unknown bone ${bone}`);
      return add(pb.head, rotate(carry.get(bone)!, sub(restPoint, rb.head)));
    },
  };
}

// ---------------------------------------------------------------- landmarks

export interface ResolvedLandmark {
  name: string;
  bone: string;
  /** REST position, three.js model space. */
  rest: Vec3;
  radius: number;
  ik?: readonly [string, string];
}

const lmCache = new WeakMap<JointMap, Map<string, ResolvedLandmark>>();

/** Landmarks whose bone this map has, with REST positions. Missing bones are skipped. */
export function resolveLandmarks(map: JointMap): Map<string, ResolvedLandmark> {
  const hit = lmCache.get(map);
  if (hit) return hit;
  const rf = restFrames(map);
  const out = new Map<string, ResolvedLandmark>();
  for (const [name, d] of Object.entries(LANDMARKS)) {
    const rb = rf.bones.get(d.bone);
    if (!rb) continue;
    out.set(name, { name, bone: d.bone, rest: add(lerp3(rb.head, rb.tail, d.at), d.offset), radius: d.radius ?? 0, ik: d.ik });
  }
  lmCache.set(map, out);
  return out;
}

/** Where a landmark is in a posed rig (the centre, for round ones). Null if the map lacks its bone. */
export function landmark(posed: Posed, map: JointMap, name: string): [number, number, number] | null {
  const lm = resolveLandmarks(map).get(name);
  return lm ? posed.pointOn(lm.bone, lm.rest) : null;
}

/** Every landmark the map supports, posed. */
export function landmarks(posed: Posed, map: JointMap): Map<string, { point: Vec3; radius: number }> {
  const out = new Map<string, { point: Vec3; radius: number }>();
  for (const lm of resolveLandmarks(map).values()) out.set(lm.name, { point: posed.pointOn(lm.bone, lm.rest), radius: lm.radius });
  return out;
}
