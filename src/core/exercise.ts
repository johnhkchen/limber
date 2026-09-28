/**
 * The exercise file: plain joint movements in degrees over time.
 *
 * Contract (docs/knowledge/anatomy-pipeline.md, "The exercise file"):
 * - Angles are degrees relative to REST (anatomical position). Missing joints stay at REST.
 * - Times are seconds on the *authored* timeline. A `hold` is inserted at `hold.from`:
 *   anything authored after `hold.from` plays that much later.
 * - Joint names are plain (`upperBack`, `shoulder.r`), never bone names. `joint-map.json`
 *   (see jointmap.ts) turns them into bones and axes.
 * - The whole body (all optional, older files still work): `setup.start` names the starting
 *   position and gives a default `root`; a keyframe's `root` (pelvis position + pitch/yaw/roll)
 *   is interpolated like the joints; `props` puts a wall/doorframe/ball/mat in the room; `contacts`
 *   say which landmark (landmarks.ts) touches which surface over which stretch. ground.ts turns that
 *   into a grounded root and checks it.
 * - `reps` is a number (play N times) or `{ count, holdBreaths?, laterHoldBreaths?, restSeconds? }`; `sets`
 *   repeats all reps. `laterHoldBreaths` makes reps after the first hold shorter ("hold 5 breaths, then
 *   repeat 5–6 times holding briefly"), so reps can differ in length.
 *
 * Pure TypeScript. No Svelte, Threlte or three.js here.
 */

import { ease, type Easing, EASINGS } from './easing';
import { LANDMARKS, type LandmarkName } from './landmarks';
import type { Vec3 } from './quat';

/** One joint's movements, e.g. `{ flexion: 90, horizontalAdduction: 40 }`. Degrees, except `pelvis` x/y/z (metres) and `breath.amount` / `grip.*.amount` (0..1). */
export type JointPose = Record<string, number>;
/** Joint id (`upperBack`, `shoulder.r`) → movements. */
export type Pose = Record<string, JointPose>;

export interface Keyframe {
  t: number;
  pose: Pose;
  /** Easing for the stretch that *arrives* at this keyframe. Default `inOut`. */
  ease?: Easing;
  /** Where the whole body is. Missing fields come from the setup's root. Interpolated like joints. */
  root?: RootInput;
}

// ---------------------------------------------------------------- the body in the world

/**
 * How the whole body is turned, in degrees, applied as roll first, then pitch, then yaw
 * (world R = yaw · pitch · roll, about the pelvis). At 0/0/0 the body stands upright facing +Z.
 * - `pitch` +: tip forward, face toward the floor (90 = lying face down, head toward +Z; -90 = on the back).
 * - `yaw` +: turn the front toward the subject's right (same sign as trunk rotation).
 * - `roll` +: tip toward the subject's right, right side down (90 = lying on the right side;
 *   -90 = lying on the left side).
 */
export interface Orientation {
  pitch?: number;
  yaw?: number;
  roll?: number;
}

/** Root as authored: every field optional. */
export interface RootInput {
  /** Where the pelvis (the `Hips` bone head) is, metres, three.js world (+Y up, floor at y = 0). */
  position?: Vec3;
  orientation?: Orientation;
}

/** Root with everything filled in. */
export interface Root {
  position: Vec3;
  orientation: Required<Orientation>;
}

export const SETUP_NAMES = [
  'standing', 'sitting', 'kneeling', 'allFours', 'sideLyingLeft', 'sideLyingRight', 'againstWall',
] as const;
export type SetupName = (typeof SETUP_NAMES)[number];

/** Starting position, named. `root` overrides the default root for every keyframe. */
export interface Setup {
  start: SetupName;
  root?: RootInput;
}

export interface SetupInfo {
  /** Default root. y is only a starting guess: grounding (ground.ts) sets it from the contacts. */
  root: Root;
  /** What usually touches, for authors. Not applied: an exercise declares its own `contacts`. */
  typicalContacts: readonly { part: LandmarkName; surface: Surface }[];
}

const r = (position: Vec3, orientation: Orientation = {}): Root => ({
  position,
  orientation: { pitch: 0, yaw: 0, roll: 0, ...orientation },
});

/** Default root per starting position. Pelvis heights fit this rig (hips 0.94 m up when standing). */
export const SETUPS: Readonly<Record<SetupName, SetupInfo>> = {
  standing: { root: r([0, 0.94, 0]), typicalContacts: [
    { part: 'heel.l', surface: 'floor' }, { part: 'heel.r', surface: 'floor' },
    { part: 'toes.l', surface: 'floor' }, { part: 'toes.r', surface: 'floor' }] },
  sitting: { root: r([0, 0.52, 0]), typicalContacts: [
    { part: 'heel.l', surface: 'floor' }, { part: 'heel.r', surface: 'floor' }] },
  kneeling: { root: r([0, 0.47, 0]), typicalContacts: [
    { part: 'knee.l', surface: 'floor' }, { part: 'knee.r', surface: 'floor' },
    { part: 'shin.l', surface: 'floor' }, { part: 'shin.r', surface: 'floor' }] },
  allFours: { root: r([0, 0.47, 0], { pitch: 90 }), typicalContacts: [
    { part: 'palm.l', surface: 'floor' }, { part: 'palm.r', surface: 'floor' },
    { part: 'knee.l', surface: 'floor' }, { part: 'knee.r', surface: 'floor' }] },
  sideLyingLeft: { root: r([0, 0.17, 0], { roll: -90 }), typicalContacts: [
    { part: 'hip.l', surface: 'floor' }, { part: 'shoulder.l', surface: 'floor' },
    { part: 'knee.l', surface: 'floor' }] },
  sideLyingRight: { root: r([0, 0.17, 0], { roll: 90 }), typicalContacts: [
    { part: 'hip.r', surface: 'floor' }, { part: 'shoulder.r', surface: 'floor' },
    { part: 'knee.r', surface: 'floor' }] },
  againstWall: { root: r([0, 0.94, 0]), typicalContacts: [
    { part: 'heel.l', surface: 'floor' }, { part: 'heel.r', surface: 'floor' },
    { part: 'back.r', surface: 'wall' }] },
};

/**
 * Things in the room. The floor (y = 0) is always there; listing it is optional.
 * - `wall`: a flat wall `distance` metres (default 0.3) from the origin on that side of the body at
 *   yaw 0 (`behind` = -Z, `front` = +Z, `left` = +X, `right` = -X). Grounding slides the body
 *   along the wall's normal until its wall contacts touch.
 * - `doorframe`: a vertical post. It is placed where the gripping hand is at the first keyframe of
 *   its contact, and later keyframes are checked against that spot. `height` is where to grab
 *   (metres, or a named height of this rig).
 * - `ball`: a tennis/lacrosse ball `at` a landmark, a point (three.js world), or a structure
 *   (`za_name`, which only the app can place). `diameter` default 0.065 m. A wall contact on the
 *   landmark the ball is `at` keeps a gap of one ball diameter.
 * - `mat`: a yoga mat, looks only. Its top is the floor.
 * - `pillow`: a pillow on the floor `under` a landmark (default `head.l`), `height` metres tall
 *   (default 0.085: the head's height above the floor when lying on the side, for this rig). It's
 *   placed where that landmark is at the first keyframe and stays there. Contacts on `pillow` touch
 *   its top (y = height).
 */
export type Prop =
  | { kind: 'floor' }
  | { kind: 'mat'; thickness?: number }
  | { kind: 'wall'; side: WallSide; distance?: number }
  | { kind: 'doorframe'; side: 'left' | 'right'; height?: number | 'chest' | 'shoulder' | 'waist' }
  | { kind: 'ball'; at: LandmarkName | Vec3 | string; diameter?: number }
  | { kind: 'pillow'; under?: LandmarkName; height?: number };
export type WallSide = 'behind' | 'front' | 'left' | 'right';
export const PROP_KINDS = ['floor', 'mat', 'wall', 'doorframe', 'ball', 'pillow'] as const;

export type Surface = 'floor' | 'wall' | 'doorframe' | 'pillow';
export const SURFACES: readonly Surface[] = ['floor', 'wall', 'doorframe', 'pillow'];

/** A body part touching a surface over a stretch of the authored timeline. */
export interface Contact {
  /** Landmark name (landmarks.ts), e.g. `palm.r`, `knee.l`, `forehead`, `back.r`. */
  part: LandmarkName;
  surface: Surface;
  /** Authored seconds, inclusive. Default: from the first keyframe / to the last. */
  from?: number;
  to?: number;
  /** Metres the part should stay off the surface (e.g. a ball between back and wall). Default 0. */
  gap?: number;
}

/**
 * Repeats. `count` may be a range, `[5, 6]` for "5–6 times": the player plays the lower number.
 * `holdBreaths` replaces `hold.breaths` for each rep (the first rep, when `laterHoldBreaths` is set).
 * `laterHoldBreaths` is the hold for every rep after the first ("then hold briefly each time").
 * `restSeconds` pauses between reps.
 */
export interface Reps {
  count: number | readonly [number, number];
  holdBreaths?: number;
  laterHoldBreaths?: number;
  restSeconds?: number;
}

/** Rounds of all the reps. Default one set. */
export interface Sets {
  count: number;
  restSeconds?: number;
}

export interface Hold {
  /** Authored time the hold starts at. */
  from: number;
  /** Number of breaths to hold for. */
  breaths: number;
  /** Seconds per breath (in + out). */
  breathSeconds: number;
}

export interface BreathTrack {
  /** `hold`: breathe only during the hold. `always`: breathe the whole time. `none`: ribs stay put. */
  track: 'hold' | 'always' | 'none';
  /** Breath amount at full out / full in, 0..1. */
  min: number;
  max: number;
  /** Seconds per breath outside a hold (track `always`). Default 5. */
  seconds?: number;
}

export interface Cue {
  /** Authored time the cue appears. */
  t: number;
  text: string;
  /** Authored time the cue goes away. Default: when the next cue appears, or the end. */
  until?: number;
  /** Only on the first rep, or only on the later ones (e.g. "hold 5 breaths" vs "hold briefly"). Default every rep. */
  rep?: 'first' | 'later';
}

export type Side = 'left' | 'right' | 'both';

export interface Exercise {
  id: string;
  /** Plain name shown to people, e.g. "Across-body reach". */
  title?: string;
  side?: Side;
  /** Z-Anatomy structure names (`extras.za_name`) that light up. */
  highlight: string[];
  keyframes: Keyframe[];
  hold?: Hold;
  breath?: BreathTrack;
  cues?: Cue[];
  /** Play the whole timeline this many times (a number), or reps with breaths and rests. Default 1. */
  reps?: number | Reps;
  sets?: Sets;
  /** Starting position; gives the default root. No setup = standing. */
  setup?: Setup;
  props?: Prop[];
  contacts?: Contact[];
}

// ---------------------------------------------------------------- joint catalog

const AXIAL = ['flexion', 'rotation', 'sideBend'] as const;

/**
 * Joints the exercise file may name, and the movements each one takes. From the design doc's table,
 * with the movement names the pipeline measured (joint-map.json). Signs: + is the named movement;
 * for axial joints + flexion bends forward, + sideBend bends to the subject's right, + rotation turns
 * the front to the subject's right (so -rotation turns it left).
 */
export const JOINT_MOVEMENTS: Readonly<Record<string, readonly string[]>> = (() => {
  const t: Record<string, readonly string[]> = {
    pelvis: ['x', 'y', 'z', 'tilt', 'turn', 'sideBend'],
    lowBack: AXIAL,
    upperBack: AXIAL,
    neck: AXIAL,
    head: AXIAL,
    breath: ['amount'],
  };
  // grip.l / grip.r: 0 = open hand, 1 = full fist (fingers and thumb, per joint-map deg_at_full).
  t['grip.l'] = ['amount'];
  t['grip.r'] = ['amount'];
  const sided: Record<string, readonly string[]> = {
    shoulderGirdle: ['elevation', 'protraction'],
    scapula: ['upwardRotation', 'posteriorTilt', 'internalRotation'],
    shoulder: ['flexion', 'abduction', 'rotation', 'horizontalAdduction'],
    elbow: ['flexion', 'pronation'],
    wrist: ['flexion', 'ulnarDeviation'],
    hip: ['flexion', 'abduction', 'rotation'],
    knee: ['flexion'],
    ankle: ['dorsiflexion'],
  };
  for (const [j, m] of Object.entries(sided)) {
    t[`${j}.l`] = m;
    t[`${j}.r`] = m;
  }
  return t;
})();

// ---------------------------------------------------------------- validation

export class ExerciseError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isVec3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every(isNum);

function checkRoot(v: unknown, at: string, bad: (m: string) => void): void {
  if (!isObj(v)) return bad(`${at}: { position?, orientation? }`);
  for (const k of Object.keys(v)) if (k !== 'position' && k !== 'orientation') bad(`${at}: unknown field "${k}"`);
  if (v.position !== undefined && !isVec3(v.position)) bad(`${at}.position: [x, y, z] metres`);
  if (v.orientation !== undefined) {
    const o = v.orientation;
    if (!isObj(o)) return bad(`${at}.orientation: { pitch?, yaw?, roll? } degrees`);
    for (const [k, d] of Object.entries(o)) {
      if (!['pitch', 'yaw', 'roll'].includes(k)) bad(`${at}.orientation: unknown field "${k}" (pitch, yaw, roll)`);
      else if (!isNum(d)) bad(`${at}.orientation.${k}: degrees`);
    }
  }
}

/**
 * Check an unknown JSON value against the contract and return it typed.
 * Throws `ExerciseError` listing every problem found.
 */
export function parseExercise(json: unknown): Exercise {
  const errs: string[] = [];
  const bad = (m: string) => errs.push(m);
  if (!isObj(json)) throw new ExerciseError('exercise: not an object');
  const e = json;

  if (typeof e.id !== 'string' || !e.id) bad('id: required string');
  if (e.title !== undefined && typeof e.title !== 'string') bad('title: must be a string');
  if (e.side !== undefined && !['left', 'right', 'both'].includes(e.side as string))
    bad('side: left | right | both');
  if (!Array.isArray(e.highlight) || e.highlight.some((h) => typeof h !== 'string'))
    bad('highlight: array of za_name strings');

  if (!Array.isArray(e.keyframes) || e.keyframes.length === 0) {
    bad('keyframes: at least one');
  } else {
    let prev = -Infinity;
    e.keyframes.forEach((k: unknown, i: number) => {
      if (!isObj(k)) return bad(`keyframes[${i}]: not an object`);
      if (!isNum(k.t) || k.t < 0) bad(`keyframes[${i}].t: number >= 0`);
      else if (k.t <= prev) bad(`keyframes[${i}].t: times must increase`);
      else prev = k.t;
      if (k.ease !== undefined && !(EASINGS as readonly string[]).includes(k.ease as string))
        bad(`keyframes[${i}].ease: one of ${EASINGS.join(', ')}`);
      if (k.root !== undefined) checkRoot(k.root, `keyframes[${i}].root`, bad);
      if (!isObj(k.pose)) return bad(`keyframes[${i}].pose: object`);
      for (const [joint, mv] of Object.entries(k.pose)) {
        const allowed = JOINT_MOVEMENTS[joint];
        if (!allowed) {
          bad(`keyframes[${i}].pose: unknown joint "${joint}"`);
          continue;
        }
        if (!isObj(mv)) {
          bad(`keyframes[${i}].pose.${joint}: object`);
          continue;
        }
        for (const [m, v] of Object.entries(mv)) {
          if (!allowed.includes(m)) bad(`keyframes[${i}].pose.${joint}: unknown movement "${m}"`);
          else if (!isNum(v)) bad(`keyframes[${i}].pose.${joint}.${m}: number`);
        }
      }
    });
  }

  if (e.hold !== undefined) {
    const h = e.hold;
    if (!isObj(h) || !isNum(h.from) || !isNum(h.breaths) || !isNum(h.breathSeconds) ||
        h.from < 0 || h.breaths < 0 || h.breathSeconds <= 0)
      bad('hold: { from >= 0, breaths >= 0, breathSeconds > 0 }');
  }
  if (e.breath !== undefined) {
    const b = e.breath;
    if (!isObj(b) || !['hold', 'always', 'none'].includes(b.track as string) ||
        !isNum(b.min) || !isNum(b.max) || (b.seconds !== undefined && (!isNum(b.seconds) || b.seconds <= 0)))
      bad('breath: { track: hold|always|none, min, max, seconds? }');
  }
  if (e.cues !== undefined) {
    if (!Array.isArray(e.cues)) bad('cues: array');
    else
      e.cues.forEach((c: unknown, i: number) => {
        if (!isObj(c) || !isNum(c.t) || typeof c.text !== 'string' ||
            (c.until !== undefined && !isNum(c.until)) ||
            (c.rep !== undefined && c.rep !== 'first' && c.rep !== 'later'))
          bad(`cues[${i}]: { t, text, until?, rep?: first | later }`);
      });
  }
  const isCount = (v: unknown) => isNum(v) && v >= 1 && Number.isInteger(v);
  if (e.reps !== undefined) {
    const rp = e.reps;
    if (isNum(rp)) {
      if (!isCount(rp)) bad('reps: integer >= 1');
    } else if (!isObj(rp)) {
      bad('reps: integer >= 1, or { count, holdBreaths?, laterHoldBreaths?, restSeconds? }');
    } else {
      const c = rp.count;
      const okCount = isCount(c) ||
        (Array.isArray(c) && c.length === 2 && isCount(c[0]) && isCount(c[1]) && (c[0] as number) <= (c[1] as number));
      if (!okCount) bad('reps.count: integer >= 1, or [low, high]');
      if (rp.holdBreaths !== undefined) {
        if (!isNum(rp.holdBreaths) || rp.holdBreaths < 0) bad('reps.holdBreaths: number >= 0');
        else if (e.hold === undefined) bad('reps.holdBreaths: needs a hold to know when to hold');
      }
      if (rp.laterHoldBreaths !== undefined) {
        if (!isNum(rp.laterHoldBreaths) || rp.laterHoldBreaths < 0) bad('reps.laterHoldBreaths: number >= 0');
        else if (e.hold === undefined) bad('reps.laterHoldBreaths: needs a hold to know when to hold');
      }
      if (rp.restSeconds !== undefined && (!isNum(rp.restSeconds) || rp.restSeconds < 0))
        bad('reps.restSeconds: number >= 0');
    }
  }
  if (e.sets !== undefined) {
    const st = e.sets;
    if (!isObj(st) || !isCount(st.count) || (st.restSeconds !== undefined && (!isNum(st.restSeconds) || st.restSeconds < 0)))
      bad('sets: { count: integer >= 1, restSeconds? }');
  }

  if (e.setup !== undefined) {
    const su = e.setup;
    if (!isObj(su) || !(SETUP_NAMES as readonly string[]).includes(su.start as string))
      bad(`setup.start: one of ${SETUP_NAMES.join(', ')}`);
    else if (su.root !== undefined) checkRoot(su.root, 'setup.root', bad);
  }

  const kinds: string[] = [];
  if (e.props !== undefined) {
    if (!Array.isArray(e.props)) bad('props: array');
    else
      e.props.forEach((pr: unknown, i: number) => {
        const at = `props[${i}]`;
        if (!isObj(pr) || !(PROP_KINDS as readonly string[]).includes(pr.kind as string))
          return bad(`${at}.kind: one of ${PROP_KINDS.join(', ')}`);
        kinds.push(pr.kind as string);
        switch (pr.kind) {
          case 'mat':
            if (pr.thickness !== undefined && (!isNum(pr.thickness) || pr.thickness < 0)) bad(`${at}.thickness: number >= 0`);
            break;
          case 'wall':
            if (!['behind', 'front', 'left', 'right'].includes(pr.side as string)) bad(`${at}.side: behind | front | left | right`);
            if (pr.distance !== undefined && (!isNum(pr.distance) || pr.distance < 0)) bad(`${at}.distance: number >= 0`);
            break;
          case 'doorframe':
            if (!['left', 'right'].includes(pr.side as string)) bad(`${at}.side: left | right`);
            if (pr.height !== undefined && !(isNum(pr.height) && pr.height > 0) &&
                !['chest', 'shoulder', 'waist'].includes(pr.height as string))
              bad(`${at}.height: metres > 0, or chest | shoulder | waist`);
            break;
          case 'ball':
            if (!(typeof pr.at === 'string' && pr.at) && !isVec3(pr.at)) bad(`${at}.at: landmark, structure name, or [x, y, z]`);
            if (pr.diameter !== undefined && (!isNum(pr.diameter) || pr.diameter <= 0)) bad(`${at}.diameter: number > 0`);
            break;
          case 'pillow':
            if (pr.under !== undefined && !(typeof pr.under === 'string' && pr.under in LANDMARKS)) bad(`${at}.under: unknown body part "${String(pr.under)}"`);
            if (pr.height !== undefined && (!isNum(pr.height) || pr.height <= 0 || pr.height > 0.4)) bad(`${at}.height: metres, > 0 and <= 0.4`);
            break;
        }
      });
    for (const k of ['wall', 'doorframe', 'pillow'])
      if (kinds.filter((x) => x === k).length > 1) bad(`props: at most one ${k}`);
  }

  if (e.contacts !== undefined) {
    if (!Array.isArray(e.contacts)) bad('contacts: array');
    else
      e.contacts.forEach((c: unknown, i: number) => {
        const at = `contacts[${i}]`;
        if (!isObj(c)) return bad(`${at}: object`);
        if (typeof c.part !== 'string' || !(c.part in LANDMARKS)) bad(`${at}.part: unknown body part "${String(c.part)}"`);
        if (!(SURFACES as readonly string[]).includes(c.surface as string)) bad(`${at}.surface: ${SURFACES.join(' | ')}`);
        else if (c.surface !== 'floor' && !kinds.includes(c.surface as string))
          bad(`${at}.surface: "${String(c.surface)}" needs a ${String(c.surface)} in props`);
        if (c.from !== undefined && !isNum(c.from)) bad(`${at}.from: number`);
        if (c.to !== undefined && !isNum(c.to)) bad(`${at}.to: number`);
        if (isNum(c.from) && isNum(c.to) && c.to < c.from) bad(`${at}: to before from`);
        if (c.gap !== undefined && (!isNum(c.gap) || c.gap < 0)) bad(`${at}.gap: number >= 0`);
      });
  }

  if (errs.length) throw new ExerciseError(`exercise ${String(e.id ?? '?')}: ${errs.join('; ')}`);
  return e as unknown as Exercise;
}

// ---------------------------------------------------------------- timeline

/**
 * The hold as played on rep `rep` (1-based, default the first): `reps.holdBreaths` replaces
 * `hold.breaths`, and `reps.laterHoldBreaths` replaces it again from rep 2 on.
 */
export function holdOf(ex: Exercise, rep = 1): Hold | undefined {
  if (!ex.hold) return undefined;
  const rp = typeof ex.reps === 'object' ? ex.reps : undefined;
  const hb = rep > 1 && rp?.laterHoldBreaths !== undefined ? rp.laterHoldBreaths : rp?.holdBreaths;
  return hb !== undefined ? { ...ex.hold, breaths: hb } : ex.hold;
}

const holdLength = (ex: Exercise, rep = 1) => {
  const h = holdOf(ex, rep);
  return h ? h.breaths * h.breathSeconds : 0;
};

/** Reps the player plays (the low end of a range). */
export function repCount(ex: Exercise): number {
  const rp = ex.reps;
  if (rp === undefined) return 1;
  if (typeof rp === 'number') return rp;
  return typeof rp.count === 'number' ? rp.count : rp.count[0];
}
const repRest = (ex: Exercise) => (typeof ex.reps === 'object' ? ex.reps.restSeconds ?? 0 : 0);
export const setCount = (ex: Exercise): number => ex.sets?.count ?? 1;
const setRest = (ex: Exercise) => ex.sets?.restSeconds ?? 0;

/** Authored time → played time within rep `rep` (a hold pushes later moments back). */
export function playedTime(ex: Exercise, authored: number, rep = 1): number {
  if (!ex.hold || authored <= ex.hold.from) return authored;
  return authored + holdLength(ex, rep);
}

/** Seconds for one pass of the timeline on rep `rep` (default the first). */
export function cycleLength(ex: Exercise, rep = 1): number {
  const lastKey = ex.keyframes[ex.keyframes.length - 1]!.t;
  const lastCue = Math.max(0, ...(ex.cues ?? []).map((c) => c.until ?? c.t));
  const end = Math.max(lastKey, lastCue, ex.hold?.from ?? 0);
  return playedTime(ex, end, rep) + (ex.hold && end <= ex.hold.from ? holdLength(ex, rep) : 0);
}

/** Seconds for one set: every rep, with rests between them. */
function setLength(ex: Exercise): number {
  const n = repCount(ex);
  let s = (n - 1) * repRest(ex);
  for (let r = 1; r <= n; r++) s += cycleLength(ex, r);
  return s;
}

/** Seconds for the whole exercise: all sets, all reps, all rests. */
export function duration(ex: Exercise): number {
  return setCount(ex) * setLength(ex) + (setCount(ex) - 1) * setRest(ex);
}

/**
 * Plain words for how much to do, e.g. "5 breaths, 5–6 times" or "8–10 times", or with shorter
 * later holds "5 breaths, then 2 each time, 5–6 times". Empty when it's a single pass with no hold.
 */
export function repsLabel(ex: Exercise): string {
  const parts: string[] = [];
  const h = holdOf(ex);
  const later = repCount(ex) > 1 ? holdOf(ex, 2) : undefined;
  if (h && h.breaths > 0) {
    let w = `${h.breaths} breath${h.breaths === 1 ? '' : 's'}`;
    if (later && later.breaths !== h.breaths) w += later.breaths > 0 ? `, then ${later.breaths} each time` : ', then briefly';
    parts.push(w);
  }
  const rp = ex.reps;
  const n = rp === undefined ? 1 : typeof rp === 'number' ? rp : rp.count;
  if (typeof n !== 'number') parts.push(`${n[0]}–${n[1]} times`);
  else if (n > 1) parts.push(`${n} times`);
  const s = setCount(ex);
  if (s > 1) parts.push(`${s} rounds`);
  return parts.join(', ');
}

// ---------------------------------------------------------------- sampling

export interface Frame {
  /** Joint → movements at this moment, degrees relative to REST. Includes `breath.amount`. */
  pose: Pose;
  /** Where the whole body is (before grounding; ground.ts adjusts it to the contacts). */
  root: Root;
  /** The moment on the authored timeline (for contact ranges and cues). */
  authored: number;
  /** `move` between keyframes, `hold` while holding, `rest` between reps or sets. */
  phase: 'move' | 'hold' | 'rest';
  /** Current text cue, if any. */
  cue: string | null;
  /** While breathing: which way, and which breath of how many (1-based). */
  breath: { amount: number; direction: 'in' | 'out' | null; index: number; count: number };
  /** 1-based rep within the set. */
  rep: number;
  /** 1-based set. */
  set: number;
}

function lerpPose(a: Pose, b: Pose, k: number): Pose {
  const out: Pose = {};
  const joints = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const j of joints) {
    const ja = a[j] ?? {};
    const jb = b[j] ?? {};
    const mv: JointPose = {};
    for (const m of new Set([...Object.keys(ja), ...Object.keys(jb)])) {
      const va = ja[m] ?? 0;
      const vb = jb[m] ?? 0;
      mv[m] = va + (vb - va) * k;
    }
    out[j] = mv;
  }
  return out;
}

/** The root every keyframe starts from: the setup's default (standing if none), then `setup.root`. */
export function setupRoot(ex: Exercise): Root {
  const base = SETUPS[ex.setup?.start ?? 'standing'].root;
  return mergeRoot(base, ex.setup?.root);
}

function mergeRoot(base: Root, over: RootInput | undefined): Root {
  if (!over) return base;
  return {
    position: over.position ?? base.position,
    orientation: { ...base.orientation, ...over.orientation },
  };
}

/** A keyframe's root with the gaps filled from the setup. */
export function keyframeRoot(ex: Exercise, k: Keyframe): Root {
  return mergeRoot(setupRoot(ex), k.root);
}

function lerpRoot(a: Root, b: Root, k: number): Root {
  const l = (x: number, y: number) => x + (y - x) * k;
  return {
    position: [l(a.position[0], b.position[0]), l(a.position[1], b.position[1]), l(a.position[2], b.position[2])],
    orientation: {
      pitch: l(a.orientation.pitch, b.orientation.pitch),
      yaw: l(a.orientation.yaw, b.orientation.yaw),
      roll: l(a.orientation.roll, b.orientation.roll),
    },
  };
}

/** Which keyframes bracket an authored moment, and the eased blend between them. */
function bracket(ex: Exercise, authored: number): { a: Keyframe; b: Keyframe; k: number } {
  const ks = ex.keyframes;
  if (authored <= ks[0]!.t) return { a: ks[0]!, b: ks[0]!, k: 0 };
  for (let i = 1; i < ks.length; i++) {
    const b = ks[i]!;
    if (authored <= b.t) {
      const a = ks[i - 1]!;
      return { a, b, k: ease(b.ease ?? 'inOut', (authored - a.t) / (b.t - a.t)) };
    }
  }
  const last = ks[ks.length - 1]!;
  return { a: last, b: last, k: 0 };
}

/** Pose on the authored timeline (no hold, no breath). Clamps outside the keyframes. */
export function poseAt(ex: Exercise, authored: number): Pose {
  const { a, b, k } = bracket(ex, authored);
  return lerpPose(a.pose, b.pose, k);
}

/** Root on the authored timeline, eased like the joints. Angles blend per component. */
export function rootAt(ex: Exercise, authored: number): Root {
  const { a, b, k } = bracket(ex, authored);
  return lerpRoot(keyframeRoot(ex, a), keyframeRoot(ex, b), k);
}

/** Contacts in force at an authored moment. */
export function activeContacts(ex: Exercise, authored: number): Contact[] {
  const first = ex.keyframes[0]!.t;
  const last = ex.keyframes[ex.keyframes.length - 1]!.t;
  const eps = 1e-9;
  return (ex.contacts ?? []).filter(
    (c) => authored >= (c.from ?? first) - eps && authored <= (c.to ?? last) + eps,
  );
}

/** 0 at full out, 1 at full in; a breath starts on the way in. */
const breathWave = (phase01: number) => (1 - Math.cos(2 * Math.PI * phase01)) / 2;

/**
 * The heart of it: exercise + played time t (seconds) → what every joint does, where the body is,
 * the cue and the breath. `t` is clamped to [0, duration].
 */
export function sample(ex: Exercise, t: number): Frame {
  const reps = repCount(ex);
  const sets = setCount(ex);
  const sLen = setLength(ex);
  const total = duration(ex);
  const tc = Math.min(Math.max(t, 0), total);

  // Which set, which rep, and are we resting between them?
  const setSpan = sLen + setRest(ex);
  let set = setSpan > 0 ? Math.min(Math.floor(tc / setSpan), sets - 1) : 0;
  let inSet = tc - set * setSpan;
  let resting = false;
  if (inSet > sLen) { // resting after this set
    inSet = sLen;
    resting = true;
  }
  // Reps can differ in length (a shorter hold after the first), so walk them.
  let rep = 0;
  let local = inSet;
  while (rep < reps - 1 && local >= cycleLength(ex, rep + 1) + repRest(ex)) {
    local -= cycleLength(ex, rep + 1) + repRest(ex);
    rep++;
  }
  const cyc = cycleLength(ex, rep + 1);
  if (local > cyc) { // resting after this rep
    local = cyc;
    resting = true;
  }
  if (set >= sets) set = sets - 1;

  // Played → authored time, and whether we're inside the hold.
  let authored = local;
  let holdT: number | null = null;
  const hold = holdOf(ex, rep + 1);
  if (hold) {
    const hl = holdLength(ex, rep + 1);
    if (local > hold.from && local < hold.from + hl) {
      authored = hold.from;
      holdT = local - hold.from;
    } else if (local >= hold.from + hl) {
      authored = local - hl;
    }
  }

  const pose = poseAt(ex, authored);
  const root = rootAt(ex, authored);

  // Breath.
  const bt = ex.breath ?? { track: 'none', min: 0, max: 0 };
  let amount = bt.min;
  let direction: Frame['breath']['direction'] = null;
  let index = 0;
  let count = 0;
  const breathe = (sinceStart: number, seconds: number, n: number) => {
    const i = Math.floor(sinceStart / seconds);
    const ph = (sinceStart - i * seconds) / seconds;
    amount = bt.min + (bt.max - bt.min) * breathWave(ph);
    direction = ph < 0.5 ? 'in' : 'out';
    index = Math.min(i + 1, n);
    count = n;
  };
  if (!resting && bt.track === 'hold' && holdT !== null && hold) {
    breathe(holdT, hold.breathSeconds, hold.breaths);
  } else if (!resting && bt.track === 'always') {
    const s = bt.seconds ?? 5;
    breathe(local, s, Math.max(1, Math.ceil(cyc / s)));
  }
  const breathJoint = pose.breath?.amount;
  pose.breath = { amount: breathJoint !== undefined ? breathJoint + amount : amount };

  // Cue: the latest cue that has started and not ended.
  const cues = ex.cues ?? [];
  let cue: string | null = null;
  const which = rep === 0 ? 'first' : 'later';
  const sorted = cues.filter((c) => !c.rep || c.rep === which).sort((a, b) => a.t - b.t);
  const played = (a: number) => playedTime(ex, a, rep + 1);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const start = played(c.t);
    const next = sorted[i + 1];
    const end = c.until !== undefined ? played(c.until) : next ? played(next.t) : Infinity;
    if (local >= start && local < end) cue = c.text;
  }

  return {
    pose,
    root,
    authored,
    phase: resting ? 'rest' : holdT !== null ? 'hold' : 'move',
    cue: resting ? null : cue,
    breath: { amount: pose.breath.amount!, direction, index, count },
    rep: rep + 1,
    set: set + 1,
  };
}
