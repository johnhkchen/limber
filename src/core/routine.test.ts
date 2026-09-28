import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { duration, holdOf, parseExercise, repCount } from './exercise';
import {
  RIGHT_SHOULDER_BLADE as R, applyDose, currentMove, doseWords, movesLeft, routineReducer, stageWords, startRoutine,
  type RoutineEvent, type RoutineState,
} from './routine';

const run = (s: RoutineState, ...events: RoutineEvent[]) => events.reduce((acc, e) => routineReducer(R, acc, e), s);
const ids = R.steps.map((s) => s.exercise);
const reach = parseExercise(JSON.parse(readFileSync('content/exercises/across-body-reach.json', 'utf8')));

describe('the golden routine', () => {
  it('has the case’s five moves in order, with its doses', () => {
    expect(ids).toEqual(['across-body-reach', 'childs-pose-side-reach', 'thread-the-needle', 'open-book', 'ball-release']);
    expect(R.steps.map((s) => doseWords(s.dose))).toEqual([
      '5 breaths', '5–8 breaths', '5 breaths, 5–6 times', '8–10 slow reps', '3–4 breaths',
    ]);
  });

  it('speaks plainly', () => {
    const states = [startRoutine(R), run(startRoutine(R), ...ids.map(() => ({ type: 'next' }) as const))];
    for (const s of states) expect(stageWords(R, s)).not.toMatch(/diagnos|protocol|regimen/i);
    expect(R.howToUse).toMatch(/one round of all five/);
  });
});

describe('a round', () => {
  it('steps through all five, then asks for the deep-breath test', () => {
    let s = startRoutine(R);
    expect(s.stage).toBe('moves');
    expect(currentMove(R, s)!.exercise).toBe('across-body-reach');
    expect(movesLeft(s)).toBe(5);
    s = run(s, { type: 'next' }, { type: 'next' }, { type: 'next' }, { type: 'next' });
    expect(currentMove(R, s)!.exercise).toBe('ball-release');
    s = run(s, { type: 'next' });
    expect(s.stage).toBe('check');
    expect(s.done).toEqual(ids);
    expect(currentMove(R, s)).toBeNull();
    expect(stageWords(R, s)).toMatch(/deep breath/);
  });

  it('back and goto move around the round', () => {
    let s = run(startRoutine(R), { type: 'next' }, { type: 'next' }, { type: 'back' });
    expect(s.at).toBe(1);
    s = run(s, { type: 'goto', at: 99 });
    expect(s.at).toBe(4);
    s = run(s, { type: 'next' }, { type: 'back' });
    expect(s).toMatchObject({ stage: 'moves', at: 4 });
  });

  it('a move that brings the catch back is left and skipped from then on', () => {
    let s = run(startRoutine(R), { type: 'next', feel: 'fine' }, { type: 'next', feel: 'catch' }); // child's pose caught
    expect(s.round).not.toContain('childs-pose-side-reach');
    expect(currentMove(R, s)!.exercise).toBe('thread-the-needle');
    expect(s.feel['childs-pose-side-reach']).toBe('catch');
    // saying so later, about a move still ahead, drops it too
    s = run(s, { type: 'feel', exercise: 'open-book', feel: 'catch' });
    expect(s.round).toEqual(['across-body-reach', 'thread-the-needle', 'ball-release']);
    expect(currentMove(R, s)!.exercise).toBe('thread-the-needle');
    // the next round starts without them
    const next = run(s, { type: 'restart' });
    expect(next.round).toEqual(['across-body-reach', 'thread-the-needle', 'ball-release']);
    expect(next.stage).toBe('moves');
  });

  it('catch on the last move goes straight to the breath test', () => {
    const s = run(startRoutine(R), ...[0, 1, 2, 3].map(() => ({ type: 'next' }) as const), { type: 'next', feel: 'catch' });
    expect(s.stage).toBe('check');
  });

  it('carries yesterday’s "brought the catch back" into a new routine', () => {
    const s = startRoutine(R, { 'thread-the-needle': 'catch', 'open-book': 'helped' });
    expect(s.round).toHaveLength(4);
    expect(s.feel['open-book']).toBe('helped');
    expect(startRoutine({ ...R, steps: [R.steps[0]!] }, { 'across-body-reach': 'catch' }).stage).toBe('check');
  });
});

describe('after the round', () => {
  const finish = (feels: Record<string, 'helped' | 'fine' | 'catch'>) =>
    run(startRoutine(R), ...ids.map((id) => ({ type: 'next', feel: feels[id] }) as const));

  it('one move clearly helped: repeat that one through the day', () => {
    let s = run(finish({ 'thread-the-needle': 'helped', 'open-book': 'fine' }), { type: 'check', breath: 'easier' });
    expect(s).toMatchObject({ stage: 'repeat', favourite: 'thread-the-needle', breath: 'easier' });
    expect(currentMove(R, s)!.exercise).toBe('thread-the-needle');
    expect(stageWords(R, s)).toMatch(/a few times today \(5 breaths, 5–6 times\)/);
    s = run(s, { type: 'again' }, { type: 'again' });
    expect(s.repeats).toBe(2);
  });

  it('more than one helped: choose which to come back to', () => {
    let s = run(finish({ 'across-body-reach': 'helped', 'ball-release': 'helped' }), { type: 'check', breath: 'same' });
    expect(s).toMatchObject({ stage: 'choose', candidates: ['across-body-reach', 'ball-release'] });
    expect(run(s, { type: 'choose', exercise: 'open-book' })).toBe(s); // not a candidate: ignored
    s = run(s, { type: 'choose', exercise: 'ball-release' });
    expect(s).toMatchObject({ stage: 'repeat', favourite: 'ball-release', candidates: [] });
  });

  it('a candidate that brings the catch back drops out of the choice', () => {
    const s = run(finish({ 'across-body-reach': 'helped', 'ball-release': 'helped' }), { type: 'check', breath: 'same' },
      { type: 'feel', exercise: 'ball-release', feel: 'catch' });
    expect(s).toMatchObject({ stage: 'repeat', favourite: 'across-body-reach' });
  });

  it('the favourite brings the catch back: stop repeating it', () => {
    const s = run(finish({ 'open-book': 'helped' }), { type: 'check', breath: 'easier' },
      { type: 'again' }, { type: 'feel', exercise: 'open-book', feel: 'catch' });
    expect(s).toMatchObject({ stage: 'done', favourite: null });
    expect(currentMove(R, s)).toBeNull();
  });

  it('nothing clearly helped: done for now', () => {
    const s = run(finish({}), { type: 'check', breath: 'same' });
    expect(s.stage).toBe('done');
    expect(stageWords(R, s)).toMatch(/try the round again later/);
  });

  it('the breath felt worse: rest, even if something seemed to help', () => {
    const s = run(finish({ 'open-book': 'helped' }), { type: 'check', breath: 'worse' });
    expect(s).toMatchObject({ stage: 'done', favourite: null });
    expect(stageWords(R, s)).toMatch(/^Rest for now/);
  });

  it('ignores events that don’t fit the stage', () => {
    const s = startRoutine(R);
    expect(run(s, { type: 'check', breath: 'easier' })).toBe(s);
    expect(run(s, { type: 'again' })).toBe(s);
    const done = run(finish({}), { type: 'check', breath: 'same' });
    expect(run(done, { type: 'next' })).toBe(done);
  });

  it('is plain JSON (the app can store it anywhere)', () => {
    const s = run(finish({ 'open-book': 'helped' }), { type: 'check', breath: 'easier' });
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe('doses on an exercise', () => {
  it('breaths set the hold; times set the reps (low end plays)', () => {
    const thread = R.steps.find((s) => s.exercise === 'thread-the-needle')!;
    const ex = applyDose(reach, thread.dose);
    expect(holdOf(ex)!.breaths).toBe(5);
    expect(repCount(ex)).toBe(5);
    expect(duration(ex)).toBeCloseTo(5 * 36.4);
    const child = applyDose(reach, { breaths: [5, 8] });
    expect(holdOf(child)!.breaths).toBe(5);
    expect(repCount(child)).toBe(1);
    expect(applyDose(reach, {})).toEqual(reach);
  });

  it('breaths without a hold in the file change nothing', () => {
    const noHold = parseExercise({ id: 'n', highlight: [], keyframes: [{ t: 0, pose: {} }] });
    expect(applyDose(noHold, { breaths: 5 })).toEqual(noHold);
    expect(repCount(applyDose(noHold, { times: [8, 10], slow: true }))).toBe(8);
  });
});
