/**
 * A routine: the case's set of moves, in order, with how much of each, and the "how to use them"
 * logic from docs/knowledge/cases/right-shoulder-blade.md:
 *
 *   Do one round of all five, then test with a deep breath. If one exercise clearly helps, repeat
 *   that one several times through the day. A stretch or tolerable tenderness is fine; if an
 *   exercise brings back the sharp catch, skip it.
 *
 * Pure data and reducers. No storage: the app keeps `RoutineState` wherever it likes (it's plain
 * JSON) and feeds events in.
 *
 * Stages:
 *   moves  → stepping through the round (moves marked `catch` are left out)
 *   check  → take a deep breath; how did it feel?
 *   choose → more than one move helped: pick the one to come back to
 *   repeat → come back to the one that helped, a few times through the day
 *   done   → nothing clearly helped (or the breath felt worse): rest, try again later
 */

import type { Exercise, Reps } from './exercise';

/** What you said about a move. `catch` = it brought the sharp catch back: skip it. */
export type Feel = 'helped' | 'fine' | 'catch';
export const FEELS: readonly Feel[] = ['helped', 'fine', 'catch'];
export const FEEL_WORDS: Readonly<Record<Feel, string>> = {
  helped: 'Helped',
  fine: 'Fine',
  catch: 'Brought the catch back',
};

/** The deep-breath test after a round. */
export type BreathCheck = 'easier' | 'same' | 'worse';

/** How much of a move: breaths to hold, times to do it. Ranges read "5–8". */
export interface Dose {
  breaths?: number | readonly [number, number];
  times?: number | readonly [number, number];
  /** "slow reps": say so. */
  slow?: boolean;
}

export interface RoutineStep {
  /** content/exercises/<exercise>.json id. */
  exercise: string;
  dose: Dose;
}

export interface Routine {
  id: string;
  steps: readonly RoutineStep[];
  /** Plain words: how to use the routine. */
  howToUse: string;
  /** Plain words: what's fine, what means skip. */
  guideline: string;
}

/** The golden case's five moves, in the case's order and doses. */
export const RIGHT_SHOULDER_BLADE: Routine = {
  id: 'right-shoulder-blade',
  steps: [
    { exercise: 'across-body-reach', dose: { breaths: 5 } },
    { exercise: 'childs-pose-side-reach', dose: { breaths: [5, 8] } },
    { exercise: 'thread-the-needle', dose: { breaths: 5, times: [5, 6] } },
    { exercise: 'open-book', dose: { times: [8, 10], slow: true } },
    { exercise: 'ball-release', dose: { breaths: [3, 4] } },
  ],
  howToUse:
    'Do one round of all five, then take a deep breath to test. If one clearly helps, do that one a few more times through the day.',
  guideline: 'A stretch, or tenderness you can live with, is fine. If a move brings back the sharp catch, skip it.',
};

// ---------------------------------------------------------------- doses

const low = (v: number | readonly [number, number]) => (typeof v === 'number' ? v : v[0]);
const words = (v: number | readonly [number, number]) => (typeof v === 'number' ? `${v}` : `${v[0]}–${v[1]}`);
const plural = (v: number | readonly [number, number], one: string, many: string) =>
  typeof v === 'number' && v === 1 ? one : many;

/** "5 breaths, 5–6 times", "8–10 slow reps", "3–4 deep breaths" style. */
export function doseWords(d: Dose): string {
  const parts: string[] = [];
  if (d.breaths !== undefined) parts.push(`${words(d.breaths)} ${plural(d.breaths, 'breath', 'breaths')}`);
  if (d.times !== undefined)
    parts.push(d.slow ? `${words(d.times)} slow ${plural(d.times, 'rep', 'reps')}` : `${words(d.times)} ${plural(d.times, 'time', 'times')}`);
  return parts.join(', ');
}

/**
 * The exercise as this routine doses it (the player plays the low end of a range):
 * - `breaths` sets how long the hold lasts (needs a hold in the file; ignored otherwise),
 * - `times` sets the reps, keeping any rest the file already had.
 */
export function applyDose(ex: Exercise, d: Dose): Exercise {
  const out: Exercise = { ...ex };
  const old: Reps = typeof ex.reps === 'object' ? ex.reps : { count: ex.reps ?? 1 };
  let reps: Reps = { ...old };
  if (d.times !== undefined) reps = { ...reps, count: d.times };
  if (d.breaths !== undefined && ex.hold) reps = { ...reps, holdBreaths: low(d.breaths) };
  if (d.times !== undefined || (d.breaths !== undefined && ex.hold)) out.reps = reps;
  return out;
}

// ---------------------------------------------------------------- state

export type Stage = 'moves' | 'check' | 'choose' | 'repeat' | 'done';

export interface RoutineState {
  stage: Stage;
  /** The round's moves, in order, without the ones that brought the catch back. */
  round: string[];
  /** Index into `round` while stage is `moves`. */
  at: number;
  /** Per exercise id: the last thing you said about it. */
  feel: Record<string, Feel>;
  /** Moves you finished this round. */
  done: string[];
  breath: BreathCheck | null;
  /** The move to come back to through the day. */
  favourite: string | null;
  /** Times you've come back to it. */
  repeats: number;
  /** Moves that helped, when there's more than one to choose from. */
  candidates: string[];
}

export type RoutineEvent =
  /** Finished the current move (optionally saying how it felt). */
  | { type: 'next'; feel?: Feel }
  | { type: 'back' }
  | { type: 'goto'; at: number }
  /** Say how a move felt, any time. `catch` on the current move leaves it and moves on. */
  | { type: 'feel'; exercise: string; feel: Feel }
  /** The deep-breath test at the end of a round. */
  | { type: 'check'; breath: BreathCheck }
  /** Pick which helpful move to come back to. */
  | { type: 'choose'; exercise: string }
  /** Came back to the favourite once more. */
  | { type: 'again' }
  /** Start a fresh round (keeps what you said, still skips `catch`). */
  | { type: 'restart' };

const skipped = (s: Pick<RoutineState, 'feel'>, id: string) => s.feel[id] === 'catch';

/** A fresh round. `feel` carries over from earlier (e.g. yesterday's "brought the catch back"). */
export function startRoutine(r: Routine, feel: Record<string, Feel> = {}): RoutineState {
  const round = r.steps.map((s) => s.exercise).filter((id) => feel[id] !== 'catch');
  return {
    stage: round.length ? 'moves' : 'check',
    round,
    at: 0,
    feel: { ...feel },
    done: [],
    breath: null,
    favourite: null,
    repeats: 0,
    candidates: [],
  };
}

/** Drop moves marked `catch` from the round, keeping `at` on the same move (or the next one). */
function prune(s: RoutineState): RoutineState {
  const cur = s.round[s.at];
  const round = s.round.filter((id) => !skipped(s, id));
  if (round.length === s.round.length) return s;
  let at = cur !== undefined ? round.indexOf(cur) : -1;
  if (at < 0) {
    // the current one was dropped: the next surviving move takes its place
    const after = s.round.slice(s.at + 1).find((id) => !skipped(s, id));
    at = after !== undefined ? round.indexOf(after) : round.length;
  }
  const next = { ...s, round, at };
  return s.stage === 'moves' && at >= round.length ? { ...next, at: Math.max(0, round.length - 1), stage: 'check' } : next;
}

/** After the breath check: who helped decides what's next. */
function decide(s: RoutineState, r: Routine): RoutineState {
  if (s.breath === 'worse') return { ...s, stage: 'done', favourite: null, candidates: [] };
  const helped = r.steps.map((x) => x.exercise).filter((id) => s.feel[id] === 'helped');
  if (helped.length === 1) return { ...s, stage: 'repeat', favourite: helped[0]!, candidates: [] };
  if (helped.length > 1) return { ...s, stage: 'choose', candidates: helped, favourite: null };
  return { ...s, stage: 'done', favourite: null, candidates: [] };
}

export function routineReducer(r: Routine, s: RoutineState, e: RoutineEvent): RoutineState {
  switch (e.type) {
    case 'next': {
      if (s.stage !== 'moves') return s;
      const id = s.round[s.at];
      let n: RoutineState = { ...s, feel: { ...s.feel }, done: id && !s.done.includes(id) ? [...s.done, id] : s.done };
      if (id && e.feel) n.feel[id] = e.feel;
      if (id && e.feel === 'catch') return prune(n); // prune moves on to the next one
      n = s.at + 1 >= s.round.length ? { ...n, stage: 'check' } : { ...n, at: s.at + 1 };
      return n;
    }
    case 'back':
      if (s.stage === 'moves') return { ...s, at: Math.max(0, s.at - 1) };
      if (s.stage === 'check' && s.round.length) return { ...s, stage: 'moves', at: s.round.length - 1 };
      return s;
    case 'goto':
      if ((s.stage !== 'moves' && s.stage !== 'check') || !s.round.length) return s;
      return { ...s, stage: 'moves', at: Math.min(Math.max(0, Math.floor(e.at)), s.round.length - 1) };
    case 'feel': {
      const n: RoutineState = { ...s, feel: { ...s.feel, [e.exercise]: e.feel } };
      if (e.feel !== 'catch') return n;
      const pruned = prune(n);
      // The one you were repeating (or choosing between) brought the catch back: decide again
      // from the moves that still helped.
      if ((s.stage === 'repeat' && s.favourite === e.exercise) || s.stage === 'choose') return decide(pruned, r);
      return pruned;
    }
    case 'check':
      if (s.stage !== 'check') return s;
      return decide({ ...s, breath: e.breath }, r);
    case 'choose':
      if (s.stage !== 'choose' || !s.candidates.includes(e.exercise)) return s;
      return { ...s, stage: 'repeat', favourite: e.exercise, candidates: [] };
    case 'again':
      if (s.stage !== 'repeat') return s;
      return { ...s, repeats: s.repeats + 1 };
    case 'restart':
      return startRoutine(r, s.feel);
  }
}

// ---------------------------------------------------------------- reading the state

/** The move to do now: the current one in the round, or the favourite while repeating. */
export function currentMove(r: Routine, s: RoutineState): RoutineStep | null {
  const id = s.stage === 'moves' ? s.round[s.at] : s.stage === 'repeat' ? s.favourite : null;
  return id ? r.steps.find((x) => x.exercise === id) ?? null : null;
}

/** Moves left in this round, current one included. */
export const movesLeft = (s: RoutineState): number => (s.stage === 'moves' ? s.round.length - s.at : 0);

/** One plain line for where you are. */
export function stageWords(r: Routine, s: RoutineState): string {
  switch (s.stage) {
    case 'moves':
      return `Move ${s.at + 1} of ${s.round.length}.`;
    case 'check':
      return 'Take a slow, deep breath. Does it catch less than before?';
    case 'choose':
      return 'More than one helped. Pick the one to come back to today.';
    case 'repeat': {
      const step = r.steps.find((x) => x.exercise === s.favourite);
      const dose = step ? doseWords(step.dose) : '';
      return `Come back to this one a few times today${dose ? ` (${dose})` : ''}.`;
    }
    case 'done':
      return s.breath === 'worse'
        ? 'Rest for now. Heat and easy breaths can help. Try the round again later.'
        : 'Nothing clearly helped this time. Rest, and try the round again later.';
  }
}
