/**
 * joint-map.json: plain joint movements → bones and axes.
 *
 * The pipeline writes `pipeline/out/joint-map.json` (pipeline/scripts/joints.py), measured on the
 * flattened rig, and `just anatomy-publish` copies it to `public/anatomy/`. This module reads that file
 * as is. Exercise files never name bones; this table does.
 *
 * What the file gives us (only the parts used here):
 *
 * ```json
 * {
 *   "joints": {
 *     "shoulder.r": { "bone": "RightArm", "movements": {
 *       "flexion": { "bone": "RightArm", "axis_three": [0.984, -0.002, -0.178] } } },
 *     "vertebra.T5": { "bone": "T5", "movements": { "rotation": { "bone": "T5", "axis_three": [...] } } },
 *     "breath": { "movements": { "rib5.r": { "bone": "Rib5-Start.r", "axis_three": [...], "share": 0.7 } } }
 *   },
 *   "bones": { "T5": { "parent": "T6", ... } },
 *   "breath_max_deg": 3,
 *   "helpers": [{ "bone": "MH_RhomboidMajor_r_0", "parent": "T4", "target": "MT_RhomboidMajor_r_0",
 *                 "rest_length": 0.09, "stretch_axis_three": [0, 0, -1], "volume_axis_three": [0, 1, 0] }]
 * }
 * ```
 *
 * `axis_three` is a unit axis in the bone's own REST frame as three.js loads it; a positive angle does
 * the named movement (the pipeline checked each one by posing). So a movement of v degrees is the
 * local rotation `fromAxisVector(axis_three, v)`, and the app sets `bone.quaternion = rest · delta`.
 *
 * What this module adds (the couplings the flattened rig no longer has, see anatomy-pipeline.md):
 * - `upperBack`, `lowBack` and `neck` are spread over T12–T1, L5–L1 and C7–C1 by SPREAD below.
 * - `breath.amount` (0..1) turns each rib by `amount · share · breath_max_deg` about its measured axis.
 * - Stretch helpers ("bands", pipeline/scripts/bands.py) are re-created per frame by `helperPose`.
 */

import type { Pose } from './exercise';
import { type Quat, IDENTITY, conj, fromAxisVector, mul, normalize, rotate, type Vec3 } from './quat';

export interface AxisMove {
  bone: string;
  axis_three: Vec3;
  /** Breath entries: the rib's share of the breath. */
  share?: number;
}

export interface Helper {
  bone: string;
  parent: string;
  target: string;
  rest_length: number;
  volume?: string;
  stretch_axis_three: Vec3;
  volume_axis_three: Vec3;
}

export interface JointMap {
  joints: Record<string, { bone?: string; movements: Record<string, AxisMove> }>;
  bones: Record<string, { parent: string | null }>;
  breath_max_deg?: number;
  helpers?: Helper[];
}

export interface BonePose {
  /** Delta rotation in bone-local space, relative to REST. */
  quaternion: Quat;
}

export interface BonePoses {
  bones: Record<string, BonePose>;
  /** `joint.movement` pairs the pose used that the map doesn't cover. Not an error: they stay at REST. */
  unmapped: string[];
}

const DEG = Math.PI / 180;

/**
 * How a trunk movement is shared between vertebrae (fractions sum to 1). Even for now: the rig gives
 * no better numbers and the golden case only needs a gentle curve. Adjust here, not in exercise files.
 */
export const SPREAD: Readonly<Record<string, readonly string[]>> = {
  upperBack: ['T12', 'T11', 'T10', 'T9', 'T8', 'T7', 'T6', 'T5', 'T4', 'T3', 'T2', 'T1'],
  lowBack: ['L5', 'L4', 'L3', 'L2', 'L1'],
  neck: ['C7', 'C6', 'C5', 'C4', 'C3', 'C2', 'C1'],
};

/**
 * Order rotations compose in on one bone, outermost first (q = q_hAdd · q_flexion · q_abduction · …),
 * the same order pipeline/scripts/render.py uses, so the app and the Blender renders agree.
 */
export const COMPOSE_ORDER = [
  'horizontalAdduction', 'flexion', 'abduction', 'rotation', 'sideBend', 'protraction', 'elevation',
  'upwardRotation', 'posteriorTilt', 'internalRotation', 'pronation', 'ulnarDeviation', 'dorsiflexion',
  'tilt', 'turn', 'amount',
] as const;

const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number');

/** Light structural check of the pipeline's joint map. Throws with the first problem. */
export function parseJointMap(json: unknown): JointMap {
  const m = json as JointMap;
  if (!m || typeof m !== 'object') throw new Error('joint-map: not an object');
  if (!m.joints || typeof m.joints !== 'object') throw new Error('joint-map: joints missing');
  if (!m.bones || typeof m.bones !== 'object') throw new Error('joint-map: bones missing');
  for (const [j, jm] of Object.entries(m.joints)) {
    for (const [mv, mm] of Object.entries(jm.movements ?? {})) {
      if (typeof mm.bone !== 'string' || !isVec3(mm.axis_three))
        throw new Error(`joint-map: joints.${j}.${mv} needs bone and axis_three [x, y, z]`);
      if (!(mm.bone in m.bones)) throw new Error(`joint-map: joints.${j}.${mv} names unknown bone ${mm.bone}`);
    }
  }
  for (const h of m.helpers ?? []) {
    if (!(h.bone in m.bones) || !(h.parent in m.bones) || !(h.target in m.bones))
      throw new Error(`joint-map: helper ${h.bone} names an unknown bone`);
    if (!(h.rest_length > 0) || !isVec3(h.stretch_axis_three) || !isVec3(h.volume_axis_three))
      throw new Error(`joint-map: helper ${h.bone} needs rest_length and axes`);
  }
  return m;
}

/** Every bone in the rig (the app binds all of them, so unposed bones return to REST). */
export function mappedBones(map: JointMap): string[] {
  return Object.keys(map.bones);
}

/** Plain pose → per-bone local rotations (delta from REST). */
export function toBonePoses(pose: Pose, map: JointMap): BonePoses {
  const perBone = new Map<string, { order: number; axis: Vec3; deg: number }[]>();
  const unmapped: string[] = [];
  const add = (bone: string, mv: string, axis: Vec3, deg: number) => {
    if (deg === 0) return;
    const list = perBone.get(bone) ?? [];
    const o = COMPOSE_ORDER.indexOf(mv as (typeof COMPOSE_ORDER)[number]);
    list.push({ order: o < 0 ? COMPOSE_ORDER.length : o, axis, deg });
    perBone.set(bone, list);
  };

  for (const [joint, moves] of Object.entries(pose)) {
    for (const [mv, v] of Object.entries(moves)) {
      if (v === 0) continue;
      const spread = SPREAD[joint];
      if (spread) {
        const found = spread.map((b) => map.joints[`vertebra.${b}`]?.movements[mv]);
        if (found.some((f) => !f)) { unmapped.push(`${joint}.${mv}`); continue; }
        for (const f of found) add(f!.bone, mv, f!.axis_three, v / spread.length);
        continue;
      }
      if (joint === 'breath' && mv === 'amount') {
        const ribs = map.joints.breath?.movements;
        if (!ribs) { unmapped.push('breath.amount'); continue; }
        const max = map.breath_max_deg ?? 3;
        for (const r of Object.values(ribs)) add(r.bone, 'amount', r.axis_three, v * (r.share ?? 1) * max);
        continue;
      }
      const m = map.joints[joint]?.movements[mv];
      if (!m) { unmapped.push(`${joint}.${mv}`); continue; }
      add(m.bone, mv, m.axis_three, v);
    }
  }

  const bones: Record<string, BonePose> = {};
  for (const [bone, list] of perBone) {
    list.sort((a, b) => a.order - b.order);
    let q: Quat = IDENTITY;
    for (const r of list) q = mul(q, fromAxisVector(r.axis, r.deg * DEG));
    bones[bone] = { quaternion: normalize(q) };
  }
  return { bones, unmapped };
}

// ---------------------------------------------------------------- stretch helpers ("bands")

export interface Transform {
  position: Vec3;
  quaternion: Quat;
  /** Uniform scale (bones in this rig carry no scale; a scaled scene root does). */
  scale: number;
}

export interface HelperPose {
  quaternion: Quat;
  scale: Vec3;
  /** Current length / rest length. */
  stretch: number;
}

/** Shortest-arc rotation taking unit vector a onto unit vector b. */
export function arc(a: Vec3, b: Vec3): Quat {
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d < -0.999999) {
    // opposite: any axis perpendicular to a
    const p: Vec3 = Math.abs(a[0]) < 0.9 ? [0, -a[2], a[1]] : [-a[2], 0, a[0]];
    return normalize([p[0], p[1], p[2], 0]);
  }
  const c: Vec3 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  return normalize([c[0], c[1], c[2], 1 + d]);
}

/**
 * Per frame, one helper bone (Blender's STRETCH_TO, keep axis SWING_Y, volume on one axis), as
 * pipeline/scripts/bands.py `helper_runtime_matrix` does it:
 * carried by its parent, swung by the shortest arc so its stretch axis points at the target, scaled
 * along that axis by s = distance / rest length and along the volume axis by 1/s.
 *
 * @param parent   the parent bone's posed world transform
 * @param restLocal the helper's REST transform relative to its parent (its glTF node TRS at load)
 * @param target   the target bone's posed world position (a point on the scapula)
 * @param restLength head-to-target distance at REST, in world units (measure it at load)
 * @returns the helper's local rotation and scale; its local position stays at REST.
 */
export function helperPose(
  parent: Transform,
  restLocal: { position: Vec3; quaternion: Quat },
  target: Vec3,
  restLength: number,
  stretchAxis: Vec3,
  volumeAxis: Vec3,
): HelperPose {
  const off = rotate(parent.quaternion, restLocal.position);
  const head: Vec3 = [
    parent.position[0] + off[0] * parent.scale,
    parent.position[1] + off[1] * parent.scale,
    parent.position[2] + off[2] * parent.scale,
  ];
  const d: Vec3 = [target[0] - head[0], target[1] - head[1], target[2] - head[2]];
  const dist = Math.hypot(d[0], d[1], d[2]);
  const r0 = mul(parent.quaternion, restLocal.quaternion);
  if (dist < 1e-9) return { quaternion: restLocal.quaternion, scale: [1, 1, 1], stretch: 1 };
  const dn: Vec3 = [d[0] / dist, d[1] / dist, d[2] / dist];
  const swing = arc(rotate(r0, stretchAxis), dn);
  const local = normalize(mul(conj(parent.quaternion), mul(swing, r0)));
  const s = dist / restLength;
  const scale: [number, number, number] = [1, 1, 1];
  const sAx = stretchAxis.map(Math.abs).indexOf(Math.max(...stretchAxis.map(Math.abs)));
  const vAx = volumeAxis.map(Math.abs).indexOf(Math.max(...volumeAxis.map(Math.abs)));
  scale[sAx] = s;
  if (vAx !== sAx) scale[vAx] = 1 / s;
  return { quaternion: local, scale, stretch: s };
}
