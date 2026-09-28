import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cameraFromParam,
  cameraHint,
  isSkipped,
  loadExercises,
  previewItem,
  propsFromParam,
  readNotes,
  repeatsSetup,
  setFeel,
  setlist,
  setupWords,
  shelf,
  showsFloor,
  viewDirection,
  writeNotes,
} from './setlist';
import { parseExercise } from '../core/exercise';
import { RIGHT_SHOULDER_BLADE } from '../core/routine';
import reach from '../../content/exercises/across-body-reach.json';
import allFours from './previews/all-fours-test.json';

const ex = parseExercise(reach);

describe('setlist', () => {
  it('has the five moves from the golden case, in order', () => {
    expect(setlist.exercises.map((e) => e.id)).toEqual([
      'across-body-reach',
      'childs-pose-side-reach',
      'thread-the-needle',
      'open-book',
      'ball-release',
    ]);
  });

  it('is the same round as core\'s routine, in the same order', () => {
    expect(setlist.exercises.map((e) => e.id)).toEqual(RIGHT_SHOULDER_BLADE.steps.map((s) => s.exercise));
  });

  it('matches files by id and leaves the rest as coming soon', () => {
    const s = shelf(setlist.exercises, [ex]);
    expect(s[0]!.exercise?.id).toBe('across-body-reach');
    expect(s.slice(1).every((i) => i.exercise === null)).toBe(true);
  });

  it('drops a broken file instead of failing', () => {
    const { exercises, broken } = loadExercises({ a: reach, b: { id: 'x' } });
    expect(exercises).toHaveLength(1);
    expect(broken).toEqual(['b']);
  });
});

describe('optional fields', () => {
  it('says the starting position in plain words, and nothing for standing', () => {
    expect(setupWords(ex)).toBeNull();
    expect(setupWords({ ...ex, setup: { start: 'allFours' } })).toBe('Get on your hands and knees.');
  });

  it('reads dev props from the page address', () => {
    expect(propsFromParam('wall-front,ball,trampoline')).toEqual([
      { kind: 'wall', side: 'front' },
      { kind: 'ball', at: 'back.r' },
    ]);
    expect(propsFromParam(null)).toEqual([]);
  });

  it('merges camera hints, first source wins', () => {
    const h = cameraHint({ view: 'front' }, { view: 'left', elevation: 40 });
    expect(h).toMatchObject({ view: 'front', elevation: 40, fit: 'body' });
    const d = viewDirection({ ...h, elevation: 0 });
    expect(d[2]).toBeCloseTo(1);
  });
});

describe('previews and page options', () => {
  it('opens a file that is not on the setlist as a plain card', () => {
    const { exercises, broken } = loadExercises({ p: allFours });
    expect(broken).toEqual([]);
    const item = previewItem(exercises[0]!);
    expect(item.entry).toMatchObject({ id: 'all-fours-test', name: 'All fours (preview)' });
    expect(item.exercise?.setup?.start).toBe('allFours');
  });

  it('reads ?cam= as a named side or an exact spot', () => {
    expect(cameraFromParam('34')).toBe('back-right');
    expect(cameraFromParam('left')).toBe('left');
    expect(cameraFromParam('front-left')).toBe('front-left');
    expect(cameraFromParam('-1,1.5,-1.1')).toEqual([-1, 1.5, -1.1]);
    expect(cameraFromParam('nope')).toBeNull();
    expect(cameraFromParam(null)).toBeNull();
  });

  it('draws the floor only when the move is on it', () => {
    expect(showsFloor(ex)).toBe(false);
    expect(showsFloor({ ...ex, setup: { start: 'kneeling' } })).toBe(true);
    expect(showsFloor({ ...ex, props: [{ kind: 'mat' }] })).toBe(true);
  });
});

describe('notes', () => {
  it('round-trips through storage and survives junk', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const n = setFeel(readNotes(storage), 'open-book', 'catch', 1);
    writeNotes(n, storage);
    expect(isSkipped(readNotes(storage), 'open-book')).toBe(true);
    mem.set('limber.notes.v1', '{not json');
    expect(readNotes(storage)).toEqual({ feel: {}, checks: [] });
    const throwing = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); } };
    expect(readNotes(throwing)).toEqual({ feel: {}, checks: [] });
    expect(() => writeNotes(n, throwing)).not.toThrow();
  });
});

describe('repeatsSetup', () => {
  it('drops a first cue that only repeats the Start: line, keeps one that adds something', () => {
    expect(repeatsSetup('Start on your hands and knees.', 'Get on your hands and knees.')).toBe(true);
    expect(repeatsSetup('Lie on your left side, knees bent and stacked, both arms straight out in front.', 'Lie on your left side.')).toBe(false);
    expect(repeatsSetup('Start on your hands and knees.', null)).toBe(false);
  });
});

