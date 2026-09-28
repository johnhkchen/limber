import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ExerciseError, cycleLength, duration, parseExercise, playedTime, poseAt, sample, type Exercise } from './exercise';
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

describe('src/core stays framework-free', () => {
  it('imports no svelte, threlte or three', () => {
    const dir = join(root, 'src/core');
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const src = readFileSync(join(dir, f), 'utf8');
      expect(src, f).not.toMatch(/from\s+['"](svelte|@threlte|three)/);
    }
  });
});
