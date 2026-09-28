import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  ExerciseError, SETUPS, activeContacts, cycleLength, duration, holdOf, keyframeRoot, parseExercise, playedTime, poseAt,
  repCount, repsLabel, rootAt, sample, setupRoot, type Exercise,
} from './exercise';
import { ease } from './easing';

const root = join(import.meta.dirname, '..', '..');
const reach = parseExercise(JSON.parse(readFileSync(join(root, 'content/exercises/across-body-reach.json'), 'utf8')));

const simple: Exercise = {
  id: 'simple',
  highlight: [],
  keyframes: [
    { t: 0, pose: {} },
    { t: 2, pose: { 'elbow.r': { flexion: 90 } }, ease: 'linear' },
  ],
};

describe('easing', () => {
  it('starts at 0, ends at 1, clamps', () => {
    for (const k of ['linear', 'in', 'out', 'inOut'] as const) {
      expect(ease(k, 0)).toBeCloseTo(0);
      expect(ease(k, 1)).toBeCloseTo(1);
      expect(ease(k, -3)).toBeCloseTo(0);
      expect(ease(k, 7)).toBeCloseTo(1);
    }
    expect(ease('inOut', 0.5)).toBeCloseTo(0.5);
    expect(ease('step', 0.99)).toBe(0);
  });
});

describe('parseExercise', () => {
  it('accepts every exercise in content/', () => {
    const dir = join(root, 'content/exercises');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      expect(() => parseExercise(JSON.parse(readFileSync(join(dir, f), 'utf8')))).not.toThrow();
    }
  });
  it('lists every problem at once', () => {
    try {
      parseExercise({ id: 'x', highlight: [], keyframes: [{ t: 1, pose: { wing: { flap: 1 } } }, { t: 0.5, pose: { 'knee.r': { twist: 3 } } }] });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ExerciseError);
      const m = (e as Error).message;
      expect(m).toMatch(/unknown joint "wing"/);
      expect(m).toMatch(/times must increase/);
      expect(m).toMatch(/unknown movement "twist"/);
    }
  });
  it('rejects bone names in place of joints', () => {
    expect(() => parseExercise({ id: 'x', highlight: [], keyframes: [{ t: 0, pose: { RightArm: { flexion: 9 } } }] })).toThrow(/unknown joint "RightArm"/);
  });
});

describe('timeline', () => {
  it('pushes moments after the hold back by the hold length', () => {
    expect(playedTime(reach, 1)).toBe(1);
    expect(playedTime(reach, 3.6)).toBe(3.6);
    expect(playedTime(reach, 6.4)).toBeCloseTo(36.4);
    expect(cycleLength(reach)).toBeCloseTo(36.4);
    expect(duration({ ...reach, reps: 3 })).toBeCloseTo(109.2);
  });
  it('a hold on the last keyframe still counts', () => {
    const ex: Exercise = { ...simple, hold: { from: 2, breaths: 2, breathSeconds: 4 } };
    expect(cycleLength(ex)).toBe(10);
  });
});

describe('sample', () => {
  it('starts and ends at REST', () => {
    expect(sample(reach, 0).pose['shoulder.r']).toBeUndefined();
    const end = sample(reach, 36.4).pose['shoulder.r']!;
    expect(end.flexion).toBeCloseTo(0);
  });
  it('interpolates with easing, relative to REST', () => {
    expect(sample(simple, 1).pose['elbow.r']!.flexion).toBeCloseTo(45);
    const mid = sample(reach, 0.9).pose['shoulder.r']!;
    expect(mid.flexion).toBeCloseTo(42.5); // inOut at the halfway point
    expect(sample(reach, 0.3).pose['shoulder.r']!.flexion).toBeLessThan(85 * (0.3 / 1.8)); // eases in
  });
  it('freezes the pose during the hold and breathes five times', () => {
    const a = sample(reach, 5);
    const b = sample(reach, 30);
    expect(a.phase).toBe('hold');
    expect(a.pose['shoulder.r']).toEqual(b.pose['shoulder.r']);
    expect(a.pose['shoulder.r']!.flexion).toBeCloseTo(90);
    expect(sample(reach, 3.6 + 3).breath.amount).toBeCloseTo(1); // top of breath 1
    expect(sample(reach, 3.6 + 6).breath.amount).toBeCloseTo(0, 5);
    expect(sample(reach, 3.6 + 1).breath.direction).toBe('in');
    expect(sample(reach, 3.6 + 4).breath.direction).toBe('out');
    expect(sample(reach, 3.6 + 25).breath).toMatchObject({ index: 5, count: 5 });
    expect(sample(reach, 1).breath).toMatchObject({ amount: 0, direction: null });
  });
  it('shows the right cue at the right time', () => {
    expect(sample(reach, 0.5).cue).toMatch(/^Reach/);
    expect(sample(reach, 2).cue).toMatch(/^Hold on/);
    expect(sample(reach, 20).cue).toMatch(/shoulder blade slide outward/);
    expect(sample(reach, 35).cue).toBe('Let go and come back slowly.');
  });
  it('repeats for reps and clamps outside the timeline', () => {
    const ex = { ...simple, reps: 2 };
    expect(sample(ex, 3).rep).toBe(2);
    expect(sample(ex, 3).pose['elbow.r']!.flexion).toBeCloseTo(45);
    expect(sample(ex, 99).pose['elbow.r']!.flexion).toBeCloseTo(90);
    expect(sample(ex, -5).pose['elbow.r']).toBeUndefined();
  });
  it('matches poseAt on the authored timeline outside the hold', () => {
    expect(sample(reach, 35).pose['shoulder.r']!.flexion).toBeCloseTo(poseAt(reach, 5)['shoulder.r']!.flexion!);
  });
});

describe('the body in the world (root, setup, props, contacts)', () => {
  const lying: Exercise = parseExercise({
    id: 'lying',
    highlight: [],
    setup: { start: 'sideLyingLeft' },
    props: [{ kind: 'floor' }, { kind: 'mat', thickness: 0.006 }],
    keyframes: [
      { t: 0, pose: {} },
      { t: 2, ease: 'linear', pose: {}, root: { orientation: { roll: -60 } } },
      { t: 4, ease: 'linear', pose: {}, root: { position: [0.5, 0.2, 0], orientation: { yaw: 20 } } },
    ],
    contacts: [
      { part: 'hip.l', surface: 'floor' },
      { part: 'shoulder.l', surface: 'floor', from: 0, to: 2 },
    ],
  });

  it('old files still parse and play the same (root defaults to standing)', () => {
    expect(reach.setup).toBeUndefined();
    expect(sample(reach, 5).root).toEqual(SETUPS.standing.root);
    expect(sample(reach, 5).set).toBe(1);
  });

  it('keyframes without a root use the setup’s default; partial roots fill from it', () => {
    expect(setupRoot(lying)).toEqual(SETUPS.sideLyingLeft.root);
    expect(keyframeRoot(lying, lying.keyframes[1]!)).toEqual({ position: [0, 0.17, 0], orientation: { pitch: 0, yaw: 0, roll: -60 } });
    expect(keyframeRoot(lying, lying.keyframes[2]!).orientation).toEqual({ pitch: 0, yaw: 20, roll: -90 });
  });

  it('interpolates the root like the joints', () => {
    expect(rootAt(lying, 1).orientation.roll).toBeCloseTo(-75); // linear, halfway from -90 to -60
    const r = rootAt(lying, 3);
    expect(r.position[0]).toBeCloseTo(0.25);
    expect(r.orientation.roll).toBeCloseTo(-75);
    expect(r.orientation.yaw).toBeCloseTo(10);
    expect(sample(lying, 3).root).toEqual(r);
  });

  it('setup.root overrides every keyframe’s default', () => {
    const ex = parseExercise({ ...lying, setup: { start: 'allFours', root: { orientation: { pitch: 82 } } } });
    expect(rootAt(ex, 0).orientation).toEqual({ pitch: 82, yaw: 0, roll: 0 });
    expect(rootAt(ex, 0).position).toEqual(SETUPS.allFours.root.position);
  });

  it('contacts apply over their stretch of the timeline', () => {
    expect(activeContacts(lying, 1).map((c) => c.part)).toEqual(['hip.l', 'shoulder.l']);
    expect(activeContacts(lying, 2).map((c) => c.part)).toEqual(['hip.l', 'shoulder.l']);
    expect(activeContacts(lying, 3).map((c) => c.part)).toEqual(['hip.l']);
  });

  it('rejects bad roots, setups, props and contacts, all at once', () => {
    const base = { id: 'x', highlight: [] };
    const msg = (j: unknown) => {
      try { parseExercise(j); return ''; } catch (e) { return (e as Error).message; }
    };
    const m = msg({
      ...base,
      setup: { start: 'handstand' },
      props: [{ kind: 'wall', side: 'ceiling' }, { kind: 'trampoline' }, { kind: 'doorframe', side: 'left', height: 'knee' }, { kind: 'ball' }],
      keyframes: [{ t: 0, pose: {}, root: { position: [0, 1], orientation: { pitch: 'up', tilt: 3 } } }],
      contacts: [{ part: 'elbow.x', surface: 'floor' }, { part: 'palm.r', surface: 'wall' }, { part: 'knee.l', surface: 'ceiling' }],
    });
    for (const want of [/setup.start/, /props\[0\].side/, /props\[1\].kind/, /props\[2\].height/, /props\[3\].at/,
      /root.position/, /orientation.pitch/, /unknown field "tilt"/, /unknown body part "elbow.x"/, /contacts\[2\].surface/])
      expect(m).toMatch(want);
    expect(msg({ ...base, keyframes: [{ t: 0, pose: {} }], contacts: [{ part: 'palm.r', surface: 'doorframe' }] })).toMatch(/needs a doorframe in props/);
    expect(msg({ ...base, keyframes: [{ t: 0, pose: {} }], props: [{ kind: 'wall', side: 'behind' }, { kind: 'wall', side: 'front' }] })).toMatch(/at most one wall/);
    expect(msg(lying)).toBe('');
  });
});

describe('reps and sets', () => {
  const thread: Exercise = {
    ...simple,
    hold: { from: 2, breaths: 3, breathSeconds: 4 },
    breath: { track: 'hold', min: 0, max: 1 },
    reps: { count: [5, 6], holdBreaths: 5 },
  };

  it('holdBreaths replaces the hold’s breaths; a range plays its low end', () => {
    expect(holdOf(thread)!.breaths).toBe(5);
    expect(repCount(thread)).toBe(5);
    expect(cycleLength(thread)).toBe(22); // 2 s in + 5 breaths × 4 s
    expect(duration(thread)).toBe(110);
    expect(sample(thread, 22 + 2 + 19).breath).toMatchObject({ index: 5, count: 5 });
    expect(sample(thread, 23).rep).toBe(2);
  });

  it('rests between reps and between sets', () => {
    const ex: Exercise = { ...simple, reps: { count: 2, restSeconds: 1 }, sets: { count: 2, restSeconds: 10 } };
    // set = 2 + 1 + 2 = 5 s; whole = 5 + 10 + 5 = 20 s
    expect(duration(ex)).toBe(20);
    expect(sample(ex, 2.5)).toMatchObject({ phase: 'rest', rep: 1, set: 1, cue: null });
    expect(sample(ex, 3.5)).toMatchObject({ phase: 'move', rep: 2, set: 1 });
    expect(sample(ex, 3.5).pose['elbow.r']!.flexion).toBeCloseTo(22.5);
    expect(sample(ex, 9)).toMatchObject({ phase: 'rest', set: 1 });
    expect(sample(ex, 16)).toMatchObject({ phase: 'move', rep: 1, set: 2 });
    expect(sample(ex, 16).pose['elbow.r']!.flexion).toBeCloseTo(45);
    expect(sample(ex, 20)).toMatchObject({ rep: 2, set: 2 });
  });

  it('a plain number still means "play it this many times"', () => {
    expect(repCount({ ...simple, reps: 3 })).toBe(3);
    expect(duration({ ...simple, reps: 3 })).toBe(6);
  });

  it('validates', () => {
    const base = { id: 'x', highlight: [], keyframes: [{ t: 0, pose: {} }] };
    expect(() => parseExercise({ ...base, reps: { count: [6, 5] } })).toThrow(/reps.count/);
    expect(() => parseExercise({ ...base, reps: { count: 5, holdBreaths: 5 } })).toThrow(/needs a hold/);
    expect(() => parseExercise({ ...base, reps: 0 })).toThrow(/reps/);
    expect(() => parseExercise({ ...base, sets: { count: 1.5 } })).toThrow(/sets/);
    expect(() => parseExercise({ ...base, reps: { count: [8, 10], restSeconds: 2 }, sets: { count: 2 } })).not.toThrow();
  });

  it('says how much in plain words', () => {
    expect(repsLabel(thread)).toBe('5 breaths, 5–6 times');
    expect(repsLabel({ ...simple, reps: { count: [8, 10] } })).toBe('8–10 times');
    expect(repsLabel(reach)).toBe('5 breaths');
    expect(repsLabel(simple)).toBe('');
  });
});

describe('src/core stays framework-free', () => {
  it('imports no svelte, threlte or three', () => {
    const dir = join(root, 'src/core');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from\s+['"](svelte|@threlte|three)/);
    }
  });
});
