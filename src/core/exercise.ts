/**
 * The exercise file: plain joint movements in degrees over time.
 *
 * Contract (docs/knowledge/anatomy-pipeline.md, "The exercise file"):
 * - Angles are degrees relative to REST (anatomical position). Missing joints stay at REST.
 * - Times are seconds on the *authored* timeline. A `hold` is inserted at `hold.from`:
 *   anything authored after `hold.from` plays that much later.
 * - Joint names are plain (`upperBack`, `shoulder.r`), never bone names. `joint-map.json`
 *   (see jointmap.ts) turns them into bones and axes.
 *
 * Pure TypeScript. No Svelte, Threlte or three.js here.
 */

import { ease, type Easing, EASINGS } from './easing';

/** One joint's movements, e.g. `{ flexion: 90, horizontalAdduction: 40 }`. Degrees, except `pelvis` x/y/z (metres) and `breath.amount` (0..1). */
export type JointPose = Record<string, number>;
/** Joint id (`upperBack`, `shoulder.r`) → movements. */
export type Pose = Record<string, JointPose>;

export interface Keyframe {
  t: number;
  pose: Pose;
  /** Easing for the stretch that *arrives* at this keyframe. Default `inOut`. */
  ease?: Easing;
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
  /** Play the whole timeline this many times. Default 1. */
  reps?: number;
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
            (c.until !== undefined && !isNum(c.until)))
          bad(`cues[${i}]: { t, text, until? }`);
      });
  }
  if (e.reps !== undefined && (!isNum(e.reps) || e.reps < 1 || !Number.isInteger(e.reps)))
    bad('reps: integer >= 1');

  if (errs.length) throw new ExerciseError(`exercise ${String(e.id ?? '?')}: ${errs.join('; ')}`);
  return e as unknown as Exercise;
}

// ---------------------------------------------------------------- timeline

const holdLength = (ex: Exercise) => (ex.hold ? ex.hold.breaths * ex.hold.breathSeconds : 0);

/** Authored time → played time (a hold pushes later moments back). */
export function playedTime(ex: Exercise, authored: number): number {
  if (!ex.hold || authored <= ex.hold.from) return authored;
  return authored + holdLength(ex);
}

/** Seconds for one pass of the timeline. */
export function cycleLength(ex: Exercise): number {
  const lastKey = ex.keyframes[ex.keyframes.length - 1]!.t;
  const lastCue = Math.max(0, ...(ex.cues ?? []).map((c) => c.until ?? c.t));
  const end = Math.max(lastKey, lastCue, ex.hold?.from ?? 0);
  return playedTime(ex, end) + (ex.hold && end <= ex.hold.from ? holdLength(ex) : 0);
}

/** Seconds for the whole exercise, all reps. */
export function duration(ex: Exercise): number {
  return cycleLength(ex) * (ex.reps ?? 1);
}

// ---------------------------------------------------------------- sampling

export interface Frame {
  /** Joint → movements at this moment, degrees relative to REST. Includes `breath.amount`. */
  pose: Pose;
  /** `move` between keyframes, `hold` while holding. */
  phase: 'move' | 'hold';
  /** Current text cue, if any. */
  cue: string | null;
  /** While breathing: which way, and which breath of how many (1-based). */
  breath: { amount: number; direction: 'in' | 'out' | null; index: number; count: number };
  /** 1-based rep. */
  rep: number;
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

/** Pose on the authored timeline (no hold, no breath). Clamps outside the keyframes. */
export function poseAt(ex: Exercise, authored: number): Pose {
  const ks = ex.keyframes;
  if (authored <= ks[0]!.t) return lerpPose(ks[0]!.pose, {}, 0);
  for (let i = 1; i < ks.length; i++) {
    const b = ks[i]!;
    if (authored <= b.t) {
      const a = ks[i - 1]!;
      const k = ease(b.ease ?? 'inOut', (authored - a.t) / (b.t - a.t));
      return lerpPose(a.pose, b.pose, k);
    }
  }
  return lerpPose(ks[ks.length - 1]!.pose, {}, 0);
}

/** 0 at full out, 1 at full in; a breath starts on the way in. */
const breathWave = (phase01: number) => (1 - Math.cos(2 * Math.PI * phase01)) / 2;

/**
 * The heart of it: exercise + played time t (seconds) → what every joint does, the cue and the breath.
 * `t` is clamped to [0, duration].
 */
export function sample(ex: Exercise, t: number): Frame {
  const cyc = cycleLength(ex);
  const reps = ex.reps ?? 1;
  const total = cyc * reps;
  const tc = Math.min(Math.max(t, 0), total);
  const rep = cyc > 0 ? Math.min(Math.floor(tc / cyc), reps - 1) : 0;
  const local = tc - rep * cyc;

  // Played → authored time, and whether we're inside the hold.
  let authored = local;
  let holdT: number | null = null;
  if (ex.hold) {
    const hl = holdLength(ex);
    if (local > ex.hold.from && local < ex.hold.from + hl) {
      authored = ex.hold.from;
      holdT = local - ex.hold.from;
    } else if (local >= ex.hold.from + hl) {
      authored = local - hl;
    }
  }

  const pose = poseAt(ex, authored);

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
  if (bt.track === 'hold' && holdT !== null && ex.hold) {
    breathe(holdT, ex.hold.breathSeconds, ex.hold.breaths);
  } else if (bt.track === 'always') {
    const s = bt.seconds ?? 5;
    breathe(local, s, Math.max(1, Math.ceil(cyc / s)));
  }
  const breathJoint = pose.breath?.amount;
  pose.breath = { amount: breathJoint !== undefined ? breathJoint + amount : amount };

  // Cue: the latest cue that has started and not ended.
  const cues = ex.cues ?? [];
  let cue: string | null = null;
  const sorted = [...cues].sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length; i++) {
    const c = sorted[i]!;
    const start = playedTime(ex, c.t);
    const next = sorted[i + 1];
    const end = c.until !== undefined ? playedTime(ex, c.until) : next ? playedTime(ex, next.t) : Infinity;
    if (local >= start && local < end) cue = c.text;
  }

  return {
    pose,
    phase: holdT !== null ? 'hold' : 'move',
    cue,
    breath: { amount: pose.breath.amount!, direction, index, count },
    rep: rep + 1,
  };
}
