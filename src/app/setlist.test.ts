import { describe, expect, it } from 'vitest';
import { current, startRound, step } from './round';
import { readFileSync } from 'node:fs';
import {
  cameraHint,
  isSkipped,
  loadExercises,
  propsFromParam,
  readNotes,
  setFeel,
  setlist,
  setupWords,
  shelf,
  viewDirection,
  writeNotes,
} from './setlist';
import { ballOnWall, placementOf, propAnchors, resolveProps, restPelvis, rootQuat, withFloor } from './placement';
import { parseExercise } from '../core/exercise';
import { parseJointMap } from '../core/jointmap';
import { rotate } from '../core/quat';
import reach from '../../content/exercises/across-body-reach.json';

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

describe('placement', () => {
  const jm = parseJointMap(JSON.parse(readFileSync('public/anatomy/joint-map.json', 'utf8')));
  const root = (o: Partial<{ pitch: number; yaw: number; roll: number }>, position: [number, number, number] = [0, 0.94, 0]) => ({
    position,
    orientation: { pitch: 0, yaw: 0, roll: 0, ...o },
  });

  it('puts the REST pelvis at the root position', () => {
    const pelvis = restPelvis(jm);
    const p = placementOf(root({}, [0.1, 0.5, 0]), jm);
    const at = rotate(p.quaternion, pelvis);
    expect(at[0] + p.position[0]).toBeCloseTo(0.1);
    expect(at[1] + p.position[1]).toBeCloseTo(0.5);
  });

  it('turns the way core says: pitch 90 face down, roll 90 right side down, yaw + faces right', () => {
    const up: [number, number, number] = [0, 1, 0];
    const front: [number, number, number] = [0, 0, 1];
    const pitch = rootQuat(root({ pitch: 90 }).orientation);
    expect(rotate(pitch, up)[2]).toBeCloseTo(1); // head toward +Z
    expect(rotate(pitch, front)[1]).toBeCloseTo(-1); // face down
    expect(rotate(rootQuat(root({ roll: 90 }).orientation), [-1, 0, 0])[1]).toBeCloseTo(-1); // right side down
    expect(rotate(rootQuat(root({ yaw: 90 }).orientation), front)[0]).toBeCloseTo(-1); // front to subject's right (-X)
  });

  it('places props from measured points, and asks only for what it needs', () => {
    const withDoor = { ...ex, props: [{ kind: 'doorframe', side: 'left' }], contacts: [{ part: 'palm.r', surface: 'doorframe', from: 1.8 }] } as never;
    const anchors = propAnchors(withDoor, [{ kind: 'doorframe', side: 'left' }]);
    expect(anchors).toEqual([{ key: 'doorframe', landmark: 'palm.r', t: 1.8 }]);
    const placed = resolveProps(
      [{ kind: 'doorframe', side: 'left' }, { kind: 'wall', side: 'behind' }, { kind: 'ball', at: 'back.r' }, { kind: 'mat' }],
      { doorframe: [0.2, 1.3, 0.4], ball: [-0.04, 1.3, -0.12] },
      { min: [-0.3, 0, -0.9], max: [0.3, 0.5, 0.9] },
    );
    expect(placed[0]).toEqual({ kind: 'doorframe', side: 'left', grip: [0.2, 1.3, 0.4] });
    expect(placed[3]).toMatchObject({ kind: 'mat', along: 'z' });
    const ball = ballOnWall(placed).find((p) => p.kind === 'ball')!;
    expect(ball.kind === 'ball' && ball.at[2]).toBeCloseTo(-0.12 - 0.0325);
  });

  it('adds a floor when the body starts on it', () => {
    expect(withFloor(ex, [])).toEqual([]);
    expect(withFloor({ ...ex, setup: { start: 'kneeling' } }, [])).toEqual([{ kind: 'floor' }]);
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

describe('round', () => {
  it('steps through the moves, skipping ones that brought the catch back, then asks', () => {
    let r = startRound(['a', 'b', 'c'], (id) => id === 'b');
    expect(r.skipped).toEqual(['b']);
    expect(current(r)).toBe('a');
    r = step(r, { type: 'next' });
    expect(current(r)).toBe('c');
    r = step(r, { type: 'next' });
    expect(r.stage).toBe('check');
    expect(current(r)).toBeNull();
    r = step(r, { type: 'back' });
    expect(current(r)).toBe('c');
  });

  it('goes straight to the check when everything is skipped', () => {
    expect(startRound(['a'], () => true).stage).toBe('check');
  });
});
