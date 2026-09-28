import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseJointMap, toBonePoses, type JointMap } from './jointmap';
import { SETUPS, type Pose, type Root } from './exercise';
import {
  forwardKinematics, landmark, landmarks, modelTransform, orientationQuat, resolveLandmarks, restFrames, toThree,
} from './fk';
import { LANDMARKS, LANDMARK_NAMES, mirrorBone } from './landmarks';
import { type Quat, type Vec3, angleBetween, fromAxisAngle, length, mul, rotate, sub } from './quat';

const real: JointMap = parseJointMap(JSON.parse(readFileSync('public/anatomy/joint-map.json', 'utf8')));
const probe = (real as unknown as { pose_probe: { pose: Pose; tails_blender: Record<string, Vec3> } }).pose_probe;
const fixture = JSON.parse(readFileSync('src/core/fixtures/helpers-blender.json', 'utf8')) as {
  helpers: { bone: string; parent_position: Vec3; parent_quaternion: Quat; target: Vec3 }[];
};
/** pipeline/scripts/render.py's test pose, which wrote the helpers fixture. */
const RENDER_POSE: Pose = {
  upperBack: { flexion: 24, rotation: -24 },
  'shoulderGirdle.r': { protraction: 20 },
  'scapula.r': { upwardRotation: 10 },
  'shoulder.r': { flexion: 90, horizontalAdduction: 40 },
  'elbow.r': { flexion: 10 },
};

const dist = (a: Vec3, b: Vec3) => length(sub(a, b));
const mm = (m: number) => m * 1000;
const none = { bones: {} };
/** Blender armature rotation → three.js world rotation (C = Rx(-90°)). */
const C = fromAxisAngle('x', -Math.PI / 2);
const root = (position: Vec3, o: Partial<Root['orientation']> = {}): Root => ({
  position,
  orientation: { pitch: 0, yaw: 0, roll: 0, ...o },
});

describe('forwardKinematics', () => {
  it('at REST puts every bone where the joint map says', () => {
    const fk = forwardKinematics(real, none);
    let worst = 0;
    for (const [n, b] of Object.entries(real.bones)) {
      const p = fk.bones.get(n)!;
      worst = Math.max(worst, dist(p.head, toThree(b.head!)), dist(p.tail, toThree(b.tail!)));
    }
    expect(mm(worst)).toBeLessThan(1e-6);
  });

  it("matches Blender's pose probe (joints.py) to well under a millimetre", () => {
    const fk = forwardKinematics(real, toBonePoses(probe.pose, real));
    const names = Object.keys(probe.tails_blender);
    expect(names.length).toBeGreaterThanOrEqual(5);
    let worst = 0;
    for (const n of names) worst = Math.max(worst, dist(fk.bones.get(n)!.tail, toThree(probe.tails_blender[n]!)));
    expect(mm(worst)).toBeLessThan(0.05); // measured ~0.004 mm; the probe rounds to 1 µm
  });

  it("matches Blender's helper parents and targets in render.py's pose (position and rotation)", () => {
    const fk = forwardKinematics(real, toBonePoses(RENDER_POSE, real));
    expect(fixture.helpers.length).toBeGreaterThan(0);
    let worstPos = 0;
    let worstRot = 0;
    for (const h of fixture.helpers) {
      const spec = real.helpers!.find((x) => x.bone === h.bone)!;
      const parent = fk.bones.get(spec.parent)!;
      worstPos = Math.max(worstPos, dist(parent.head, toThree(h.parent_position)));
      worstRot = Math.max(worstRot, angleBetween(parent.quaternion, mul(C, h.parent_quaternion)));
      worstPos = Math.max(worstPos, dist(fk.bones.get(spec.target)!.head, toThree(h.target)));
    }
    expect(mm(worstPos)).toBeLessThan(0.05);
    expect(worstRot).toBeLessThan(2e-5); // radians; the fixture rounds quaternions to 7 decimals
  });

  it('keeps every bone its length', () => {
    const fk = forwardKinematics(real, toBonePoses(probe.pose, real), root([0.3, 0.2, -1], { pitch: 40, roll: 20 }));
    for (const [n, rb] of restFrames(real).bones) {
      const p = fk.bones.get(n)!;
      expect(dist(p.head, p.tail)).toBeCloseTo(dist(rb.head, rb.tail), 9);
    }
  });
});

describe('root', () => {
  const pelvis = (r: Root) => forwardKinematics(real, none, r).bones.get(restFrames(real).root)!.head;
  const head = (r: Root) => forwardKinematics(real, none, r).bones.get('Head')!.head;
  const front = (r: Root) => landmark(forwardKinematics(real, none, r), real, 'forehead')!;
  const left = (r: Root) => landmark(forwardKinematics(real, none, r), real, 'hip.l')!;

  it('puts the pelvis at root.position, whatever the orientation', () => {
    for (const o of [{}, { pitch: 90 }, { roll: -90 }, { yaw: 30, pitch: 20, roll: 10 }]) {
      const r = root([0.1, 0.47, -0.2], o);
      expect(dist(pelvis(r), r.position)).toBeLessThan(1e-12);
    }
    expect(restFrames(real).root).toBe('Hips');
  });

  it('pitch 90 lies face down with the head toward +Z', () => {
    const r = root([0, 0.3, 0], { pitch: 90 });
    const h = sub(head(r), r.position);
    expect(h[2]).toBeGreaterThan(0.5);
    expect(Math.abs(h[1])).toBeLessThan(0.15);
    expect(front(r)[1]).toBeLessThan(head(r)[1]); // the face is below the head bone: face down
  });

  it('roll -90 lies on the left side, roll +90 on the right', () => {
    const l = root([0, 0.2, 0], { roll: -90 });
    expect(left(l)[1]).toBeLessThan(l.position[1] - 0.1);
    const rr = root([0, 0.2, 0], { roll: 90 });
    expect(left(rr)[1]).toBeGreaterThan(rr.position[1] + 0.1);
  });

  it('yaw + turns the front toward the subject’s right (-X)', () => {
    const r = root([0, 0.94, 0], { yaw: 90 });
    const f = sub(front(r), r.position);
    expect(f[0]).toBeLessThan(-0.05);
    expect(Math.abs(f[2])).toBeLessThan(0.05);
  });

  it('modelTransform matches what FK does to the rest pose', () => {
    const r = root([0.2, 0.5, 0.1], { pitch: 30, yaw: -20, roll: 5 });
    const t = modelTransform(r, real);
    const fk = forwardKinematics(real, none, r);
    const rb = restFrames(real).bones.get('RightHand')!;
    const want = fk.bones.get('RightHand')!.head;
    const got = rotate(t.quaternion, rb.head).map((v, i) => v + t.position[i]!);
    expect(dist(got as unknown as Vec3, want)).toBeLessThan(1e-12);
    expect(angleBetween(t.quaternion, orientationQuat(r.orientation))).toBeLessThan(1e-12);
  });

  it('every setup has a default root', () => {
    for (const [name, s] of Object.entries(SETUPS)) {
      expect(s.root.position, name).toHaveLength(3);
      for (const c of s.typicalContacts) expect(LANDMARKS[c.part], `${name} ${c.part}`).toBeDefined();
    }
  });
});

describe('landmarks', () => {
  const rest = landmarks(forwardKinematics(real, none), real);
  const y = (n: string) => rest.get(n)!.point[1] - rest.get(n)!.radius;

  it('all resolve on the full rig', () => {
    expect([...resolveLandmarks(real).keys()].sort()).toEqual([...LANDMARK_NAMES]);
    for (const n of ['palm.l', 'palm.r', 'knee.l', 'knee.r', 'shin.l', 'heel.r', 'toes.l', 'forehead', 'occiput', 'hip.l', 'back', 'back.r', 'head.r'])
      expect(LANDMARK_NAMES).toContain(n);
  });

  it('standing at REST, heels and toes sit on the floor (y ≈ 0)', () => {
    for (const n of ['heel.l', 'heel.r', 'toes.l', 'toes.r']) expect(Math.abs(y(n)), n).toBeLessThan(0.015);
  });

  it('sit where a person would say they are', () => {
    const p = (n: string) => rest.get(n)!.point;
    expect(p('palm.r')[2]).toBeGreaterThan(p('back.r')[2] + 0.1); // palms face forward at REST
    expect(p('forehead')[2]).toBeGreaterThan(p('occiput')[2] + 0.15);
    expect(p('forehead')[1]).toBeGreaterThan(1.6);
    expect(p('head.r')[0]).toBeLessThan(-0.06);
    expect(p('hip.r')[0]).toBeLessThan(-0.15);
    expect(p('back')[2]).toBeLessThan(-0.08);
    expect(p('knee.r')[1]).toBeGreaterThan(0.45);
    expect(p('knee.r')[1]).toBeLessThan(0.56);
  });

  it('left twins mirror the right within a few millimetres', () => {
    for (const n of LANDMARK_NAMES.filter((x) => x.endsWith('.r'))) {
      const r = rest.get(n)!.point;
      const l = rest.get(`${n.slice(0, -2)}.l`)!.point;
      expect(dist([-r[0], r[1], r[2]], l), n).toBeLessThan(0.004);
    }
    expect(mirrorBone('RightForeArm')).toBe('LeftForeArm');
    expect(mirrorBone('Calcaneus.r')).toBe('Calcaneus.l');
    expect(mirrorBone('RHipJoint')).toBe('LHipJoint');
    expect(mirrorBone('T6')).toBe('T6');
  });

  it('follow their bone when it moves', () => {
    const before = rest.get('palm.r')!.point;
    const after = landmark(forwardKinematics(real, toBonePoses({ 'shoulder.r': { flexion: 90 } }, real)), real, 'palm.r')!;
    expect(after[2] - before[2]).toBeGreaterThan(0.3); // arm swings forward
    expect(after[1] - before[1]).toBeGreaterThan(0.3); // and up
  });

  it('are skipped, not an error, when the map lacks their bone', () => {
    const tiny = parseJointMap({
      joints: {},
      bones: { Hips: { parent: null, head: [0, 0, 1], tail: [0, 0, 1.1], rest_axes: { x: [1, 0, 0], y: [0, 0, 1], z: [0, -1, 0] } } },
    });
    expect([...resolveLandmarks(tiny).keys()]).toEqual(['sacrum']);
    expect(() => restFrames(parseJointMap({ joints: {}, bones: { A: { parent: null } } }))).toThrow(/rest_axes/);
  });
});
