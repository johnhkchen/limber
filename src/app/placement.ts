/**
 * Where the body and the props go in the room. Pure TypeScript (no three.js) so it's testable; the
 * three.js side only measures landmark positions on the posed rig and hands them back here.
 *
 * World: metres, +Y up, floor at y = 0, the body faces +Z, the subject's left is +X.
 */
import type { Exercise, Orientation, Prop, Root } from '../core/exercise';
import { playedTime } from '../core/exercise';
import type { JointMap } from '../core/jointmap';
import { LANDMARKS } from '../core/landmarks';
import { fromAxisAngle, mul, rotate, type Quat, type Vec3 } from '../core/quat';

export interface Placement {
  position: [number, number, number];
  quaternion: [number, number, number, number];
}

const DEG = Math.PI / 180;

/**
 * World rotation for a root orientation: R = yaw · pitch · roll (roll first), per core's contract.
 * pitch + tips the face toward the floor (about +X); yaw + turns the front to the subject's right
 * (about -Y); roll + drops the right side (about +Z).
 * TODO(core): use core's helper if fk.ts / ground.ts exports one, so both sides can't drift.
 */
export function rootQuat(o: Required<Orientation>): Quat {
  return mul(mul(fromAxisAngle('y', -o.yaw * DEG), fromAxisAngle('x', o.pitch * DEG)), fromAxisAngle('z', o.roll * DEG));
}

/** The pelvis (`Hips` head) at REST, in three.js world, from the joint map. */
export function restPelvis(jm: JointMap | null): Vec3 {
  const name = jm?.trunk_chain?.[0] ?? 'Hips';
  const h = jm?.bones[name]?.head;
  return h ? [h[0], h[2], -h[1]] : [0, 0.94, 0];
}

/**
 * Turn the whole body about its pelvis and put the pelvis at `root.position`.
 * TODO(core): pass the *grounded* root once ground.ts lands (it moves the body so contacts touch).
 */
export function placementOf(root: Root, jm: JointMap | null): Placement {
  const q = rootQuat(root.orientation);
  const p = rotate(q, restPelvis(jm));
  return {
    position: [root.position[0] - p[0], root.position[1] - p[1], root.position[2] - p[2]],
    quaternion: [q[0], q[1], q[2], q[3]],
  };
}

// ---------------------------------------------------------------- props

/** A landmark to measure on the posed body, at a played moment. */
export interface Anchor {
  key: string;
  landmark: string;
  /** Played seconds. */
  t: number;
}

export type ResolvedProp =
  | { kind: 'floor' }
  | { kind: 'mat'; center: [number, number]; along: 'x' | 'z'; thickness: number }
  | { kind: 'wall'; side: 'behind' | 'front' | 'left' | 'right'; distance: number }
  | { kind: 'doorframe'; side: 'left' | 'right'; grip: [number, number, number] }
  | { kind: 'ball'; at: [number, number, number]; radius: number };

/** Named grab heights for this rig (metres). TODO(core): take core's table if it exports one. */
const HEIGHTS = { waist: 1.02, chest: 1.28, shoulder: 1.42 } as const;

const firstKey = (ex: Exercise) => ex.keyframes[0]!.t;

/** The landmarks the props need measured: the gripping hand for a doorframe, the ball's spot. */
export function propAnchors(ex: Exercise, props: readonly Prop[]): Anchor[] {
  const out: Anchor[] = [];
  for (const p of props) {
    if (p.kind === 'doorframe') {
      const c = ex.contacts?.find((c) => c.surface === 'doorframe');
      const part = c?.part ?? (p.side === 'left' ? 'palm.r' : 'palm.l');
      if (LANDMARKS[part]) out.push({ key: 'doorframe', landmark: part, t: playedTime(ex, c?.from ?? firstKey(ex)) });
    } else if (p.kind === 'ball' && typeof p.at === 'string' && LANDMARKS[p.at]) {
      const c = ex.contacts?.find((c) => c.surface === 'wall' && c.part === p.at);
      out.push({ key: 'ball', landmark: p.at, t: playedTime(ex, c?.from ?? firstKey(ex)) });
    }
  }
  return out;
}

const WALL_NORMAL: Record<'behind' | 'front' | 'left' | 'right', Vec3> = {
  behind: [0, 0, -1],
  front: [0, 0, 1],
  left: [1, 0, 0],
  right: [-1, 0, 0],
};

/**
 * Props with real positions. `points` are the measured anchors; `box` is the body's framing box
 * (min/max), used to lay the mat under the body. Anything that can't be placed yet is dropped.
 */
export function resolveProps(
  props: readonly Prop[],
  points: Readonly<Record<string, Vec3>>,
  box: { min: Vec3; max: Vec3 } | null,
): ResolvedProp[] {
  const out: ResolvedProp[] = [];
  for (const p of props) {
    switch (p.kind) {
      case 'floor':
        out.push({ kind: 'floor' });
        break;
      case 'mat': {
        const c: [number, number] = box ? [(box.min[0] + box.max[0]) / 2, (box.min[2] + box.max[2]) / 2] : [0, 0];
        const along = box && box.max[0] - box.min[0] > box.max[2] - box.min[2] ? 'x' : 'z';
        out.push({ kind: 'mat', center: c, along, thickness: p.thickness ?? 0.006 });
        break;
      }
      case 'wall':
        out.push({ kind: 'wall', side: p.side, distance: p.distance ?? 0.3 });
        break;
      case 'doorframe': {
        const hand = points.doorframe;
        const h = typeof p.height === 'number' ? p.height : p.height ? HEIGHTS[p.height] : hand?.[1] ?? HEIGHTS.chest;
        const sx = p.side === 'left' ? 1 : -1;
        out.push({ kind: 'doorframe', side: p.side, grip: hand ? [hand[0], h, hand[2]] : [sx * 0.3, h, 0.45] });
        break;
      }
      case 'ball': {
        const r = (p.diameter ?? 0.065) / 2;
        const at = Array.isArray(p.at) ? (p.at as Vec3) : points.ball;
        if (!at) break;
        out.push({ kind: 'ball', at: [at[0], at[1], at[2]], radius: r });
        break;
      }
    }
  }
  return out;
}

/** Nudge a ball from the skin toward the nearest listed wall by its radius, so it sits between. */
export function ballOnWall(props: ResolvedProp[]): ResolvedProp[] {
  const wall = props.find((p) => p.kind === 'wall');
  if (!wall || wall.kind !== 'wall') return props;
  const n = WALL_NORMAL[wall.side];
  return props.map((p) =>
    p.kind === 'ball' ? { ...p, at: [p.at[0] + n[0] * p.radius, p.at[1] + n[1] * p.radius, p.at[2] + n[2] * p.radius] } : p,
  );
}

/** A floor shows when it's listed, a mat is, or the body starts on the floor. */
export function withFloor(ex: Exercise, props: readonly Prop[]): Prop[] {
  const onFloor = ['kneeling', 'allFours', 'sideLyingLeft', 'sideLyingRight'].includes(ex.setup?.start ?? '');
  const has = props.some((p) => p.kind === 'floor');
  return !has && (onFloor || props.some((p) => p.kind === 'mat')) ? [{ kind: 'floor' }, ...props] : [...props];
}
