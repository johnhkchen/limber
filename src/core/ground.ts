/**
 * Grounding and contacts: put the posed body in the room so what should touch, touches.
 *
 * `groundPose(exercise, t, map)` samples the exercise, poses the rig (fk.ts), then moves the root:
 * - **Floor** (y = 0): the lowest active floor contact sits on the floor; the others report how far
 *   off they are. With no floor contact declared, the lowest landmark sits on the floor, so nobody
 *   floats or sinks.
 * - **Wall**: the body slides along the wall's normal until the closest wall contact touches (a
 *   ball between them keeps one ball's width).
 * - **Doorframe**: nothing moves. The post is placed where the gripping part is at the first
 *   keyframe of its contact; later moments report how far the hand has drifted from it.
 *
 * `checkContacts` / `checkKeyframes` report each contact's distance to its surface (+ off it,
 * − into it) and the lowest point of the body, which is what the tests hold every exercise to.
 * `reach` / `twoBoneIK` are a small analytic IK for putting a palm (or any landmark with an `ik`
 * chain) on a spot; `groundPose(..., { reach: true })` uses it to plant contacts that fall short.
 *
 * Pure TypeScript. Positions are metres, three.js world (+Y up, the body faces +Z at yaw 0).
 */

import {
  type Contact, type Exercise, type Frame, type Prop, type Root, type WallSide, activeContacts, playedTime, sample,
} from './exercise';
import { type Posed, type RigidTransform, forwardKinematics, resolveLandmarks, restFrames } from './fk';
import { type BonePoses, type JointMap, arc, toBonePoses } from './jointmap';
import { type Quat, type Vec3, add, conj, dot, length, mul, normalize, scale, sub, unit } from './quat';

/** Default wall distance from the origin, metres. */
export const WALL_DISTANCE = 0.3;
/** Default ball: a tennis ball. */
export const BALL_DIAMETER = 0.065;
/** Doorframe post radius (a hand wraps a ~5 cm post). */
export const POST_RADIUS = 0.025;
/** Where a doorframe stands when nothing grips it: this far to the side and in front. */
const POST_DEFAULT = { side: 0.35, front: 0.35 };

// ---------------------------------------------------------------- props in the room

export type ResolvedProp =
  | { kind: 'floor'; y: 0 }
  | { kind: 'mat'; thickness: number }
  | { kind: 'wall'; side: WallSide; /** A point on the wall. */ point: Vec3; /** Into the room. */ normal: Vec3 }
  | { kind: 'doorframe'; side: 'left' | 'right'; /** Post axis (vertical line) at x, z. */ x: number; z: number; height: number; radius: number }
  | { kind: 'ball'; diameter: number; /** Null when `at` names a structure only the app can place. */ centre: Vec3 | null; structure?: string };

const WALL_NORMALS: Record<WallSide, Vec3> = { behind: [0, 0, 1], front: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0] };

function wallOf(p: Extract<Prop, { kind: 'wall' }>): Extract<ResolvedProp, { kind: 'wall' }> {
  const n = WALL_NORMALS[p.side];
  return { kind: 'wall', side: p.side, normal: n, point: scale(n, -(p.distance ?? WALL_DISTANCE)) };
}

/** A named grab height, from the rig at REST (feet on the floor). */
function namedHeight(map: JointMap, h: 'chest' | 'shoulder' | 'waist'): number {
  const rf = restFrames(map);
  const bone = { chest: 'T6', shoulder: 'RightArm', waist: 'L3' }[h];
  return rf.bones.get(bone)?.head[1] ?? { chest: 1.3, shoulder: 1.39, waist: 1.04 }[h];
}

// ---------------------------------------------------------------- reports

export interface ContactReport {
  part: string;
  surface: Contact['surface'];
  /** Metres from the surface: + off it, − into it. Gap already taken off. */
  distance: number;
  /** The landmark in the world (its centre, for round ones). */
  point: Vec3;
  /** True for the contact the solver pinned (lowest on the floor, closest to the wall). */
  anchor: boolean;
  /** Doorframe only: how far the hand is above (+) or below (−) the grab height. */
  heightError?: number;
}

export interface LowestPoint {
  /** Landmark or bone (`bone:<name>`) that is lowest. */
  name: string;
  /** Its height: for landmarks the skin (centre − radius), for bones the joint centre. */
  y: number;
}

export interface Grounded {
  frame: Frame;
  /** The root after grounding: put the pelvis here. */
  root: Root;
  /** Same thing for the group that holds the GLBs (fk.ts `modelTransform`). */
  transform: RigidTransform;
  /** What to pose: toBonePoses(frame.pose), plus IK when `reach` was asked for. */
  bones: BonePoses;
  posed: Posed;
  contacts: ContactReport[];
  lowest: LowestPoint;
  props: ResolvedProp[];
}

export interface GroundOptions {
  /** Move the root to the contacts (default true). False: report distances for the authored root. */
  ground?: boolean;
  /** Plant floor/wall contacts that miss with 2-bone IK on their landmark's `ik` joints. Default false. */
  reach?: boolean;
}

// ---------------------------------------------------------------- solving

interface Solved {
  root: Root;
  bones: BonePoses;
  posed: Posed;
  contacts: ContactReport[];
  props: ResolvedProp[];
}

const gapFor = (ex: Exercise, c: Contact): number => {
  if (c.gap !== undefined) return c.gap;
  if (c.surface !== 'wall') return 0;
  const ball = (ex.props ?? []).find((p): p is Extract<Prop, { kind: 'ball' }> => p.kind === 'ball' && p.at === c.part);
  return ball ? ball.diameter ?? BALL_DIAMETER : 0;
};

function measure(
  ex: Exercise, contacts: Contact[], posed: Posed, map: JointMap, wall: Extract<ResolvedProp, { kind: 'wall' }> | null,
  post: Extract<ResolvedProp, { kind: 'doorframe' }> | null,
): ContactReport[] {
  const lms = resolveLandmarks(map);
  const out: ContactReport[] = [];
  for (const c of contacts) {
    const lm = lms.get(c.part);
    if (!lm) continue; // the map doesn't have this bone yet
    const p = posed.pointOn(lm.bone, lm.rest);
    const g = gapFor(ex, c);
    let d: number;
    let heightError: number | undefined;
    if (c.surface === 'floor') d = p[1] - lm.radius - g;
    else if (c.surface === 'wall') {
      if (!wall) continue;
      d = dot(sub(p, wall.point), wall.normal) - lm.radius - g;
    } else {
      if (!post) continue;
      d = Math.hypot(p[0] - post.x, p[2] - post.z) - post.radius - lm.radius - g;
      heightError = p[1] - post.height;
    }
    out.push({ part: c.part, surface: c.surface, distance: d, point: p, anchor: false, ...(heightError !== undefined ? { heightError } : {}) });
  }
  return out;
}

function solve(ex: Exercise, frame: Frame, map: JointMap, opts: GroundOptions, withPost: boolean): Solved {
  let bones = toBonePoses(frame.pose, map);
  const contacts = activeContacts(ex, frame.authored);
  const lms = resolveLandmarks(map);
  const wallProp = (ex.props ?? []).find((p): p is Extract<Prop, { kind: 'wall' }> => p.kind === 'wall');
  const wall = wallProp ? wallOf(wallProp) : null;

  let root: Root = frame.root;
  const place = (): Posed => forwardKinematics(map, bones, root);
  let posed = place();

  const groundRoot = () => {
    // Floor: lowest floor contact → y = 0; none declared → lowest landmark → y = 0.
    const floor = measure(ex, contacts.filter((c) => c.surface === 'floor'), posed, map, null, null);
    let dy: number;
    if (floor.length) dy = -Math.min(...floor.map((f) => f.distance));
    else {
      let low = Infinity;
      for (const lm of lms.values()) low = Math.min(low, posed.pointOn(lm.bone, lm.rest)[1] - lm.radius);
      dy = Number.isFinite(low) ? -low : 0;
    }
    // Wall: closest wall contact → touching, sliding along the wall's normal.
    let shift: Vec3 = [0, dy, 0];
    if (wall) {
      const onWall = measure(ex, contacts.filter((c) => c.surface === 'wall'), posed, map, wall, null);
      if (onWall.length) shift = add(shift, scale(wall.normal, -Math.min(...onWall.map((w) => w.distance))));
    }
    root = { ...root, position: add(root.position, shift) };
    posed = place();
  };

  if (opts.ground !== false) groundRoot();

  if (opts.reach) {
    const planted = new Set<string>();
    for (const r of measure(ex, contacts, posed, map, wall, null)) {
      const lm = lms.get(r.part);
      if (!lm?.ik || Math.abs(r.distance) < 1e-4 || planted.has(r.part)) continue;
      const n: Vec3 = r.surface === 'floor' ? [0, 1, 0] : wall!.normal;
      try {
        bones = reach(map, bones, root, r.part, sub(r.point, scale(n, r.distance))).bones;
        planted.add(r.part);
        posed = place();
      } catch {
        // chain not in this map: leave it, the report shows the miss
      }
    }
  }

  // Props.
  const props: ResolvedProp[] = [{ kind: 'floor', y: 0 }];
  let post: Extract<ResolvedProp, { kind: 'doorframe' }> | null = null;
  for (const p of ex.props ?? []) {
    if (p.kind === 'floor') continue;
    if (p.kind === 'mat') props.push({ kind: 'mat', thickness: p.thickness ?? 0.005 });
    else if (p.kind === 'wall') props.push(wall!);
    else if (p.kind === 'doorframe') {
      if (withPost) post = placePost(ex, p, map, opts);
      if (post) props.push(post);
    } else if (p.kind === 'ball') {
      const d = p.diameter ?? BALL_DIAMETER;
      if (Array.isArray(p.at)) props.push({ kind: 'ball', diameter: d, centre: p.at as Vec3 });
      else {
        const lm = lms.get(p.at as string);
        if (!lm) props.push({ kind: 'ball', diameter: d, centre: null, structure: p.at as string });
        else {
          const at = posed.pointOn(lm.bone, lm.rest);
          props.push({ kind: 'ball', diameter: d, centre: wall ? sub(at, scale(wall.normal, lm.radius + d / 2)) : at });
        }
      }
    }
  }

  const report = measure(ex, contacts, posed, map, wall, post);
  markAnchors(report);
  return { root, bones, posed, contacts: report, props };
}

function markAnchors(report: ContactReport[]) {
  for (const s of ['floor', 'wall'] as const) {
    const on = report.filter((r) => r.surface === s);
    if (!on.length) continue;
    on.reduce((a, b) => (b.distance < a.distance ? b : a)).anchor = true;
  }
}

/** Doorframe post: where the gripping part is at the first keyframe of its contact. */
function placePost(
  ex: Exercise, p: Extract<Prop, { kind: 'doorframe' }>, map: JointMap, opts: GroundOptions,
): Extract<ResolvedProp, { kind: 'doorframe' }> {
  const height = typeof p.height === 'number' ? p.height : p.height ? namedHeight(map, p.height) : null;
  const grip = (ex.contacts ?? []).find((c) => c.surface === 'doorframe');
  const lm = grip ? resolveLandmarks(map).get(grip.part) : undefined;
  if (!grip || !lm) {
    const sx = p.side === 'left' ? POST_DEFAULT.side : -POST_DEFAULT.side;
    return { kind: 'doorframe', side: p.side, x: sx, z: POST_DEFAULT.front, height: height ?? namedHeight(map, 'chest'), radius: POST_RADIUS };
  }
  const t0 = grip.from ?? ex.keyframes[0]!.t;
  const first = ex.keyframes.find((k) => k.t >= t0 - 1e-9)?.t ?? t0;
  const s = solve(ex, sample(ex, playedTime(ex, first)), map, opts, false);
  const at = s.posed.pointOn(lm.bone, lm.rest);
  // Post centre sits one hand-thickness beyond the palm, away from the body's pelvis.
  const pelvis = s.posed.bones.get(s.posed.rest.root)!.head;
  const out = unit([at[0] - pelvis[0], 0, at[2] - pelvis[2]]);
  const r = POST_RADIUS + lm.radius + (grip.gap ?? 0);
  return { kind: 'doorframe', side: p.side, x: at[0] + out[0] * r, z: at[2] + out[2] * r, height: height ?? at[1], radius: POST_RADIUS };
}

function lowestPoint(posed: Posed, map: JointMap): LowestPoint {
  let best: LowestPoint = { name: '', y: Infinity };
  for (const lm of resolveLandmarks(map).values()) {
    const y = posed.pointOn(lm.bone, lm.rest)[1] - lm.radius;
    if (y < best.y) best = { name: lm.name, y };
  }
  for (const [n, b] of posed.bones) {
    const y = Math.min(b.head[1], b.tail[1]);
    if (y < best.y) best = { name: `bone:${n}`, y };
  }
  return best;
}

/**
 * The exercise at played time `t`, placed in the room. Call it once per frame; it's cheap (one or two
 * FK passes over ~240 bones).
 */
export function groundPose(ex: Exercise, t: number, map: JointMap, opts: GroundOptions = {}): Grounded {
  const frame = sample(ex, t);
  const s = solve(ex, frame, map, opts, true);
  return {
    frame,
    root: s.root,
    transform: s.posed.transform,
    bones: s.bones,
    posed: s.posed,
    contacts: s.contacts,
    lowest: lowestPoint(s.posed, map),
    props: s.props,
  };
}

export interface ContactCheck {
  contacts: ContactReport[];
  lowest: LowestPoint;
  /** How far the lowest point is under the floor, metres (0 if nothing is). */
  belowFloor: number;
}

/** Contact distances and the lowest point at played time `t`, after grounding. */
export function checkContacts(ex: Exercise, t: number, map: JointMap, opts: GroundOptions = {}): ContactCheck {
  const g = groundPose(ex, t, map, opts);
  return { contacts: g.contacts, lowest: g.lowest, belowFloor: Math.max(0, -g.lowest.y) };
}

/** `checkContacts` at every authored keyframe (first rep). For tests and for authoring. */
export function checkKeyframes(ex: Exercise, map: JointMap, opts: GroundOptions = {}): (ContactCheck & { t: number })[] {
  return ex.keyframes.map((k) => ({ t: k.t, ...checkContacts(ex, playedTime(ex, k.t), map, opts) }));
}

// ---------------------------------------------------------------- IK

/**
 * Two-bone analytic IK. `a` is the fixed root joint (shoulder), `b` the middle joint (elbow), `c`
 * the end (palm). Returns where `b` and `c` go so `c` reaches `target`, bending in the plane of
 * `pole` (default: the current `b`). Out of reach: the chain points straight at the target.
 */
export function twoBoneIK(a: Vec3, b: Vec3, c: Vec3, target: Vec3, pole: Vec3 = b): { b: Vec3; c: Vec3; reached: boolean } {
  const l1 = length(sub(b, a));
  const l2 = length(sub(c, b));
  const toT = sub(target, a);
  const want = length(toT);
  const lo = Math.abs(l1 - l2) + 1e-9;
  const hi = l1 + l2 - 1e-9;
  const d = Math.min(Math.max(want, lo), hi);
  const u = unit(toT);
  const pv = sub(pole, a);
  let v = sub(pv, scale(u, dot(pv, u)));
  if (length(v) < 1e-9) v = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  v = unit(sub(v, scale(u, dot(v, u))));
  const cosA = Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
  const sinA = Math.sqrt(1 - cosA * cosA);
  const nb = add(a, add(scale(u, l1 * cosA), scale(v, l1 * sinA)));
  return { b: nb, c: add(a, scale(u, d)), reached: want >= lo - 1e-6 && want <= hi + 1e-6 };
}

const jointBone = (map: JointMap, joint: string): string | undefined => {
  const j = map.joints[joint];
  return j?.bone ?? Object.values(j?.movements ?? {})[0]?.bone;
};

/**
 * Put landmark `part` at `target` (world) by turning the two bones of its `ik` joints (e.g. the
 * humerus and forearm for `palm.r`). Returns new bone poses: the two bones' deltas are replaced by
 * whatever reaches, which may not be expressible as plain joint angles, so pose the app from these
 * BonePoses directly. `error` is the leftover distance (0 when in reach).
 */
export function reach(
  map: JointMap, poses: BonePoses, root: Root, part: string, target: Vec3, pole?: Vec3,
): { bones: BonePoses; error: number; reached: boolean } {
  const lm = resolveLandmarks(map).get(part);
  if (!lm?.ik) throw new Error(`reach: ${part} has no ik chain`);
  const upper = jointBone(map, lm.ik[0]);
  const lower = jointBone(map, lm.ik[1]);
  if (!upper || !lower || !map.bones[upper] || !map.bones[lower]) throw new Error(`reach: ${part} chain not in this map`);
  const rf = restFrames(map);
  const bones: Record<string, { quaternion: Quat }> = { ...poses.bones };

  const setWorld = (posed: Posed, bone: string, world: Quat) => {
    // W = W_parent · (W_parent_rest⁻¹ · W_rest) · delta  →  delta = (W_parent · W_parent_rest⁻¹ · W_rest)⁻¹ · W
    const rb = rf.bones.get(bone)!;
    const base = rb.parent === null
      ? mul(posed.transform.quaternion, rb.quaternion)
      : mul(posed.bones.get(rb.parent)!.quaternion, mul(conj(rf.bones.get(rb.parent)!.quaternion), rb.quaternion));
    bones[bone] = { quaternion: normalize(mul(conj(base), world)) };
  };

  let posed = forwardKinematics(map, { bones }, root);
  const a = posed.bones.get(upper)!.head;
  const b = posed.bones.get(lower)!.head;
  const c = posed.pointOn(lm.bone, lm.rest);
  const sol = twoBoneIK(a, b, c, target, pole ?? b);

  setWorld(posed, upper, mul(arc(unit(sub(b, a)), unit(sub(sol.b, a))), posed.bones.get(upper)!.quaternion));
  posed = forwardKinematics(map, { bones }, root);
  const b2 = posed.bones.get(lower)!.head;
  const c2 = posed.pointOn(lm.bone, lm.rest);
  setWorld(posed, lower, mul(arc(unit(sub(c2, b2)), unit(sub(sol.c, b2))), posed.bones.get(lower)!.quaternion));
  posed = forwardKinematics(map, { bones }, root);
  const end = posed.pointOn(lm.bone, lm.rest);
  return { bones: { bones, unmapped: poses.unmapped }, error: length(sub(end, target)), reached: sol.reached };
}
