import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseJointMap, toBonePoses, type JointMap } from './jointmap';
import { parseExercise, playedTime, type Exercise, type Pose } from './exercise';
import { forwardKinematics, landmark, landmarks } from './fk';
import { BALL_DIAMETER, PILLOW_HEIGHT, checkContacts, checkKeyframes, groundPose, reach, twoBoneIK } from './ground';
import { type Vec3, dot, length, sub } from './quat';

const root = join(import.meta.dirname, '..', '..');
const real: JointMap = parseJointMap(JSON.parse(readFileSync(join(root, 'public/anatomy/joint-map.json'), 'utf8')));
const dist = (a: Vec3, b: Vec3) => length(sub(a, b));

/** Tolerances the exercise files are held to. */
const CONTACT_TOL = 0.02;
const FLOOR_TOL = 0.01;

// A real all-fours (thread-the-needle start), tuned with checkContacts: forearms turned palm-down
// (REST has palms forward, so shoulder flexion alone leaves them facing the head), wrists bent back,
// ankles pointed so the toes clear the floor.
const ALL_FOURS: Pose = {
  'hip.l': { flexion: 82 }, 'hip.r': { flexion: 82 },
  'knee.l': { flexion: 90 }, 'knee.r': { flexion: 90 },
  'ankle.l': { dorsiflexion: -55 }, 'ankle.r': { dorsiflexion: -55 },
  'shoulder.l': { flexion: 90 }, 'shoulder.r': { flexion: 90 },
  'elbow.l': { pronation: 170 }, 'elbow.r': { pronation: 170 },
  'wrist.l': { flexion: -75 }, 'wrist.r': { flexion: -75 },
};
const allFours: Exercise = parseExercise({
  id: 'all-fours-test',
  highlight: [],
  setup: { start: 'allFours', root: { orientation: { pitch: 82 } } },
  props: [{ kind: 'mat' }],
  keyframes: [
    { t: 0, pose: ALL_FOURS },
    { t: 2, pose: { ...ALL_FOURS, head: { flexion: 10 } } },
  ],
  hold: { from: 2, breaths: 5, breathSeconds: 6 },
  reps: { count: [5, 6], holdBreaths: 5 },
  contacts: ['palm.l', 'palm.r', 'knee.l', 'knee.r', 'shin.l', 'shin.r'].map((part) => ({ part, surface: 'floor' })),
});

/** Elbows a little bent, so the palms float above the floor and IK has room to work. */
const bentArms: Exercise = parseExercise({
  ...allFours,
  setup: { start: 'allFours' },
  keyframes: [{ t: 0, pose: {
    ...ALL_FOURS, 'hip.l': { flexion: 90 }, 'hip.r': { flexion: 90 },
    'elbow.l': { pronation: 170, flexion: 40 }, 'elbow.r': { pronation: 170, flexion: 40 },
  } }],
  hold: undefined,
  reps: undefined,
});

const sideLying: Exercise = parseExercise({
  id: 'side-lying-test',
  highlight: [],
  setup: { start: 'sideLyingLeft' },
  keyframes: [{
    t: 0,
    pose: {
      'hip.l': { flexion: 60 }, 'hip.r': { flexion: 60 }, 'knee.l': { flexion: 70 }, 'knee.r': { flexion: 70 },
      lowBack: { sideBend: 5 },
      'shoulder.l': { flexion: 90, horizontalAdduction: 25 }, 'shoulder.r': { flexion: 90, horizontalAdduction: 25 },
    },
  }],
  contacts: [{ part: 'hip.l', surface: 'floor' }, { part: 'shoulder.l', surface: 'floor' }],
});

describe('groundPose: floor', () => {
  it('standing with no contacts: the lowest landmark sits on the floor, feet flat', () => {
    const ex = parseExercise({ id: 's', highlight: [], keyframes: [{ t: 0, pose: {} }] });
    const g = groundPose(ex, 0, real);
    expect(Math.abs(g.lowest.y)).toBeLessThan(1e-9);
    const lm = landmarks(g.posed, real);
    for (const n of ['heel.l', 'heel.r', 'toes.l', 'toes.r']) expect(lm.get(n)!.point[1], n).toBeLessThan(0.015);
    expect(g.root.position[1]).toBeCloseTo(0.936, 2); // this rig's hip height
  });

  it('all fours: lowest contact on the floor, every other within 2 cm, nothing under it', () => {
    for (const k of checkKeyframes(allFours, real)) {
      const anchors = k.contacts.filter((c) => c.anchor);
      expect(anchors).toHaveLength(1);
      expect(Math.abs(anchors[0]!.distance)).toBeLessThan(1e-9);
      for (const c of k.contacts) expect(Math.abs(c.distance), `t=${k.t} ${c.part}`).toBeLessThan(CONTACT_TOL);
      expect(k.belowFloor, `t=${k.t} ${k.lowest.name}`).toBeLessThan(FLOOR_TOL);
      expect(k.contacts.map((c) => c.part)).toEqual(['palm.l', 'palm.r', 'knee.l', 'knee.r', 'shin.l', 'shin.r']);
    }
  });

  it('holds the grounding through the hold and every rep', () => {
    const a = groundPose(allFours, playedTime(allFours, 2) + 10, real);
    expect(a.frame.phase).toBe('hold');
    expect(Math.min(...a.contacts.map((c) => c.distance))).toBeCloseTo(0, 9);
    const later = groundPose(allFours, 3 * 32 + 1, real);
    expect(later.frame.rep).toBe(4);
    expect(Math.min(...later.contacts.map((c) => c.distance))).toBeCloseTo(0, 9);
  });

  it('reach: plants the palms exactly with IK and keeps the knees down', () => {
    const before = groundPose(bentArms, 0, real).contacts.find((c) => c.part === 'palm.r')!;
    expect(before.distance).toBeGreaterThan(0.02); // bent elbows: palms in the air
    const g = groundPose(bentArms, 0, real, { reach: true });
    const by = Object.fromEntries(g.contacts.map((c) => [c.part, c.distance]));
    expect(Math.abs(by['palm.l']!)).toBeLessThan(0.001);
    expect(Math.abs(by['palm.r']!)).toBeLessThan(0.001);
    expect(Math.abs(by['knee.l']!)).toBeLessThan(CONTACT_TOL);
    expect(g.lowest.y).toBeGreaterThan(-FLOOR_TOL);
  });

  it('side-lying on the left: hip and shoulder on the floor', () => {
    const [k] = checkKeyframes(sideLying, real);
    for (const c of k!.contacts) expect(Math.abs(c.distance), c.part).toBeLessThan(CONTACT_TOL);
    expect(k!.belowFloor).toBeLessThan(FLOOR_TOL);
    const g = groundPose(sideLying, 0, real);
    expect(landmark(g.posed, real, 'hip.r')![1]).toBeGreaterThan(0.25); // right hip on top
  });

  it('ground: false keeps the authored root and reports how far off it is', () => {
    const g = groundPose(allFours, 0, real, { ground: false });
    expect(g.root.position).toEqual([0, 0.47, 0]);
    const c = checkContacts(allFours, 0, real, { ground: false });
    expect(c.contacts.every((x) => Number.isFinite(x.distance))).toBe(true);
  });

  it('a pose that sinks is caught', () => {
    // all fours with neutral ankles: the feet point straight into the floor
    const bad = parseExercise({ ...allFours, keyframes: [{ t: 0, pose: { ...ALL_FOURS, 'ankle.l': {}, 'ankle.r': {} } }], hold: undefined, reps: undefined });
    const [k] = checkKeyframes(bad, real);
    expect(k!.belowFloor).toBeGreaterThan(FLOOR_TOL);
    expect(k!.lowest.name).toMatch(/toe|phalanx of foot|toes/);
  });
});

describe('groundPose: wall, ball, doorframe', () => {
  const wall: Exercise = parseExercise({
    id: 'ball-wall-test',
    highlight: [],
    setup: { start: 'againstWall' },
    props: [{ kind: 'wall', side: 'behind' }, { kind: 'ball', at: 'back.r' }],
    keyframes: [{ t: 0, pose: { 'shoulder.l': { horizontalAdduction: 30 }, 'shoulder.r': { horizontalAdduction: 30 } } }],
    contacts: [{ part: 'back.r', surface: 'wall' }, { part: 'heel.l', surface: 'floor' }, { part: 'heel.r', surface: 'floor' }],
  });

  it('slides the body back until the ball is pinned between the sore spot and the wall', () => {
    const g = groundPose(wall, 0, real);
    const back = g.contacts.find((c) => c.part === 'back.r')!;
    expect(back.anchor).toBe(true);
    expect(Math.abs(back.distance)).toBeLessThan(1e-9);
    const w = g.props.find((p) => p.kind === 'wall')!;
    const ball = g.props.find((p) => p.kind === 'ball')!;
    if (w.kind !== 'wall' || ball.kind !== 'ball') throw new Error('props');
    expect(dot(sub(back.point, w.point), w.normal)).toBeCloseTo(BALL_DIAMETER, 9);
    expect(dot(sub(ball.centre!, w.point), w.normal)).toBeCloseTo(BALL_DIAMETER / 2, 9);
    // nothing else goes through the wall
    for (const [n, p] of landmarks(g.posed, real)) expect(dot(sub(p.point, w.point), w.normal) - p.radius, n).toBeGreaterThan(-0.01);
    expect(g.lowest.y).toBeGreaterThan(-FLOOR_TOL);
  });

  it('a ball at a structure name is left for the app to place', () => {
    const ex = parseExercise({ ...wall, props: [{ kind: 'wall', side: 'behind' }, { kind: 'ball', at: 'Rhomboid major muscle.r' }] });
    const ball = groundPose(ex, 0, real).props.find((p) => p.kind === 'ball');
    expect(ball).toMatchObject({ centre: null, structure: 'Rhomboid major muscle.r' });
  });

  it('doorframe: the post goes where the hand grabs, later drift is reported', () => {
    const ex = parseExercise({
      id: 'door-test',
      highlight: [],
      props: [{ kind: 'doorframe', side: 'left' }],
      keyframes: [
        { t: 0, pose: {} },
        { t: 1.8, pose: { 'shoulder.r': { flexion: 85, horizontalAdduction: 30 }, 'elbow.r': { flexion: 15 }, 'grip.r': { amount: 0.8 } } },
        { t: 3.6, pose: { 'shoulder.r': { flexion: 90, horizontalAdduction: 45 }, 'elbow.r': { flexion: 8 }, upperBack: { flexion: 12 }, 'grip.r': { amount: 0.8 } } },
      ],
      contacts: [{ part: 'palm.r', surface: 'doorframe', from: 1.8 }],
    });
    const [k0, k1, k2] = checkKeyframes(ex, real);
    expect(k0!.contacts).toEqual([]); // not holding yet
    expect(Math.abs(k1!.contacts[0]!.distance)).toBeLessThan(1e-9);
    expect(k1!.contacts[0]!.heightError).toBeCloseTo(0, 9);
    expect(Math.abs(k2!.contacts[0]!.distance)).toBeGreaterThan(0.001); // the hand moved: authors see by how much
    const post = groundPose(ex, 1.8, real).props.find((p) => p.kind === 'doorframe')!;
    if (post.kind !== 'doorframe') throw new Error('post');
    expect(post.x).toBeGreaterThan(0); // on the subject's left
    expect(post.z).toBeGreaterThan(0.1); // in front
  });
});

describe('groundPose: mat and pillow', () => {
  const lying: Exercise = parseExercise({
    ...sideLying,
    props: [{ kind: 'mat' }, { kind: 'pillow' }],
    contacts: [...sideLying.contacts!, { part: 'head.l', surface: 'pillow' }],
  });

  it('the mat runs along the body (pelvis to head), not along the widest box side', () => {
    const g = groundPose(lying, 0, real);
    const mat = g.props.find((p) => p.kind === 'mat')!;
    if (mat.kind !== 'mat') throw new Error('mat');
    const pelvis = g.posed.bones.get(g.posed.rest.root)!.head;
    const head = g.posed.bones.get('Head')!.head;
    const axis = Math.atan2(head[0] - pelvis[0], head[2] - pelvis[2]);
    expect(Math.abs(Math.sin(mat.yaw - axis))).toBeLessThan(0.05); // lying on the side: along X
    expect(Math.abs(Math.cos(mat.yaw))).toBeLessThan(0.1);
    // on all fours it runs front to back
    const m4 = groundPose(allFours, 0, real).props.find((p) => p.kind === 'mat')!;
    if (m4.kind !== 'mat') throw new Error('mat');
    expect(Math.abs(Math.cos(m4.yaw))).toBeGreaterThan(0.95);
  });

  it('a pillow is a raised floor: the head rests on its top, the body stays on the floor', () => {
    const g = groundPose(lying, 0, real);
    const pillow = g.props.find((p) => p.kind === 'pillow')!;
    if (pillow.kind !== 'pillow') throw new Error('pillow');
    expect(pillow.height).toBeCloseTo(PILLOW_HEIGHT, 9);
    const head = g.contacts.find((c) => c.part === 'head.l')!;
    expect(head.surface).toBe('pillow');
    expect(head.distance).toBeGreaterThan(-CONTACT_TOL);
    expect(head.point[1]).toBeGreaterThan(pillow.height - 0.01); // measured against the top, not the floor
    const at = landmark(g.posed, real, 'head.l')!;
    expect(Math.hypot(at[0] - pillow.centre[0], at[2] - pillow.centre[1])).toBeLessThan(1e-9);
    // a pillow far too tall holds the head up and the hip lifts off the floor: authors see it
    const tall = parseExercise({ ...lying, props: [{ kind: 'pillow', height: 0.2 }] });
    const t = groundPose(tall, 0, real).contacts;
    expect(t.find((c) => c.part === 'head.l')!.anchor).toBe(true);
    expect(t.find((c) => c.part === 'hip.l')!.distance).toBeGreaterThan(0.05);
  });
});

describe('IK', () => {
  it('twoBoneIK reaches, keeps lengths, bends toward the pole', () => {
    const a: Vec3 = [0, 0, 0], b: Vec3 = [0, -0.3, 0.05], c: Vec3 = [0, -0.55, 0];
    const t: Vec3 = [0.1, -0.4, 0.2];
    const s = twoBoneIK(a, b, c, t);
    expect(s.reached).toBe(true);
    expect(dist(s.c, t)).toBeLessThan(1e-9);
    expect(dist(s.b, a)).toBeCloseTo(dist(b, a), 9);
    expect(dist(s.c, s.b)).toBeCloseTo(dist(c, b), 9);
    expect(dist(s.b, [0, 0, 1])).toBeLessThan(dist(twoBoneIK(a, b, c, t, [0, 0, -1]).b, [0, 0, 1]));
  });

  it('twoBoneIK points straight at a target out of reach', () => {
    const s = twoBoneIK([0, 0, 0], [0, -0.3, 0], [0, -0.6, 0], [0, 0, 5]);
    expect(s.reached).toBe(false);
    expect(s.c[2]).toBeCloseTo(0.6, 6);
  });

  it('reach puts the right palm on a spot on the floor', () => {
    const g = groundPose(bentArms, 0, real);
    const palm = landmark(g.posed, real, 'palm.r')!;
    const target: Vec3 = [palm[0] - 0.03, 0, palm[2] + 0.02];
    const r = reach(real, g.bones, g.root, 'palm.r', target);
    expect(r.reached).toBe(true);
    expect(r.error).toBeLessThan(0.001);
    const after = landmark(forwardKinematics(real, r.bones, g.root), real, 'palm.r')!;
    expect(dist(after, target)).toBeLessThan(0.001);
    // only the humerus and forearm changed
    const changed = Object.keys(r.bones.bones).filter((b) => r.bones.bones[b] !== g.bones.bones[b]);
    expect(changed.sort()).toEqual(['RightArm', 'RightForeArm']);
    expect(() => reach(real, g.bones, g.root, 'knee.r', target)).toThrow(/no ik/);
  });
});

describe('every exercise in content/ sits on its contacts', () => {
  const dir = join(root, 'content/exercises');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    it(f, () => {
      const ex = parseExercise(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      for (const k of checkKeyframes(ex, real)) {
        for (const c of k.contacts)
          expect(Math.abs(c.distance), `${ex.id} t=${k.t} ${c.part} on ${c.surface}`).toBeLessThan(CONTACT_TOL);
        expect(k.belowFloor, `${ex.id} t=${k.t}: ${k.lowest.name} is under the floor`).toBeLessThan(FLOOR_TOL);
      }
      // and the poses map fully onto the rig
      for (const kf of ex.keyframes) expect(toBonePoses(kf.pose, real).unmapped).toEqual([]);
    });
  }
});
