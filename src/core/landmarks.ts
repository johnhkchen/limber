/**
 * Landmarks: named points on the body's surface that touch floors, walls and doorframes.
 *
 * Each one rides on a rig bone. It is written as a spot at REST (anatomical position, three.js
 * world: +Y up, the body faces +Z, the subject's left is +X): a point `at` a fraction of the way
 * from the bone's head to its tail, plus an `offset` in metres. So "the palm is 3 cm in front of the
 * middle of the third metacarpal" reads the way you'd say it. Numbers were measured on the packed
 * skeleton meshes (public/anatomy/skeleton.glb) plus a little soft tissue.
 *
 * `radius` makes a landmark round: its distance to a surface is the centre's distance minus the
 * radius, whichever way the limb is turned. Knees, shins and elbows use it; flat spots (palm,
 * forehead) are points on the skin already.
 *
 * Right-side entries are written once; the left twin mirrors x and the bone name. A landmark whose
 * bone is missing from the joint map is skipped, not an error (the map is still growing).
 *
 * Pure TypeScript, no joint-map import: exercise.ts validates contact parts against these names.
 */

import type { Vec3 } from './quat';

export interface LandmarkDef {
  /** Rig bone it rides on (right-side name for sided landmarks). */
  bone: string;
  /** 0 = bone head, 1 = bone tail. */
  at: number;
  /** REST offset from that point, metres, three.js world axes. */
  offset: Vec3;
  /** Round landmarks: distance to a surface is measured from the centre minus this. Default 0. */
  radius?: number;
  /**
   * Two joints (joint-map ids, right-side) a 2-bone IK can turn to put this landmark somewhere,
   * upper first, e.g. `['shoulder.r', 'elbow.r']` for the palm. See ground.ts `reach`.
   */
  ik?: readonly [string, string];
}

/** Sided landmarks, right side. `.l` twins are made by mirroring. */
const SIDED: Record<string, LandmarkDef> = {
  palm: { bone: 'Metacarpal bone-3rd finger.r', at: 0.5, offset: [0, 0, 0.032], ik: ['shoulder.r', 'elbow.r'] },
  fingertips: { bone: 'Distal phalanx of hand-3rd finger.r', at: 1, offset: [0, 0, 0], radius: 0.007, ik: ['shoulder.r', 'elbow.r'] },
  elbow: { bone: 'RightForeArm', at: 0, offset: [0, 0, 0], radius: 0.035 },
  forearm: { bone: 'RightForeArm', at: 0.5, offset: [0, 0, 0], radius: 0.03 },
  shoulder: { bone: 'RightArm', at: 0, offset: [-0.045, -0.01, 0] },
  hip: { bone: 'RightUpLeg', at: 0, offset: [-0.09, -0.015, 0] },
  knee: { bone: 'RightLeg', at: 0, offset: [0, 0, 0], radius: 0.05 },
  shin: { bone: 'RightLeg', at: 0.5, offset: [0, 0, 0], radius: 0.035 },
  heel: { bone: 'Calcaneus.r', at: 0, offset: [0, -0.032, -0.012] },
  toes: { bone: 'Distal phalanx of foot-1st finger.r', at: 1, offset: [0, -0.012, 0.005] },
  instep: { bone: 'Metatarsal bone-2d finger.r', at: 0.3, offset: [0, 0.02, 0] },
  /** Between the shoulder blade and the spine, about T6: where the ball goes in the golden case. */
  back: { bone: 'T6', at: 0, offset: [-0.04, 0.01, -0.028] },
  /** Side of the head, over the ear. */
  head: { bone: 'Head', at: 0, offset: [-0.081, 0.064, 0.002] },
};

/** Midline landmarks. */
const MIDLINE: Record<string, LandmarkDef> = {
  forehead: { bone: 'Head', at: 0, offset: [0, 0.074, 0.11] },
  occiput: { bone: 'Head', at: 0, offset: [0, 0.04, -0.09] },
  /** Midline of the upper back over the T6 spinous process. */
  back: { bone: 'T6', at: 0, offset: [0, 0.005, -0.018] },
  sacrum: { bone: 'Hips', at: 0, offset: [0, -0.015, -0.068] },
};

/** Right-side rig name → left-side twin. */
export function mirrorBone(name: string): string {
  if (name.endsWith('.r')) return `${name.slice(0, -2)}.l`;
  if (name.startsWith('Right')) return `Left${name.slice(5)}`;
  if (name === 'RHipJoint') return 'LHipJoint';
  return name;
}
const mirrorJoint = (j: string) => (j.endsWith('.r') ? `${j.slice(0, -2)}.l` : j);

/** Every landmark, by name (`palm.r`, `palm.l`, `forehead`, `back`, `back.r`, …). */
export const LANDMARKS: Readonly<Record<string, LandmarkDef>> = (() => {
  const t: Record<string, LandmarkDef> = { ...MIDLINE };
  for (const [n, d] of Object.entries(SIDED)) {
    t[`${n}.r`] = d;
    t[`${n}.l`] = {
      ...d,
      bone: mirrorBone(d.bone),
      offset: [-d.offset[0], d.offset[1], d.offset[2]],
      ik: d.ik ? [mirrorJoint(d.ik[0]), mirrorJoint(d.ik[1])] : undefined,
    };
  }
  return t;
})();

export type LandmarkName = string;
export const LANDMARK_NAMES: readonly string[] = Object.keys(LANDMARKS).sort();
