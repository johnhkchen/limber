import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { arc, helperPose, mappedBones, parseJointMap, SPREAD, toBonePoses, type JointMap } from './jointmap';
import { JOINT_MOVEMENTS, parseExercise } from './exercise';
import { fromAxisVector, mul, rotate, type Quat, type Vec3 } from './quat';

// The real map, as the pipeline measured it and the app serves it.
const real: JointMap = parseJointMap(JSON.parse(readFileSync('public/anatomy/joint-map.json', 'utf8')));
const fixture = JSON.parse(readFileSync('src/core/fixtures/helpers-blender.json', 'utf8')) as {
  helpers: {
    bone: string;
    parent_position: Vec3;
    parent_quaternion: Quat;
    rest_local_position: Vec3;
    rest_local_quaternion: Quat;
    target: Vec3;
    rest_length: number;
    expected_matrix3: number[][];
  }[];
};

const angleOf = (q: Quat) => (2 * Math.acos(Math.min(1, Math.abs(q[3])))) * (180 / Math.PI);

const tiny: JointMap = parseJointMap({
  bones: { A: { parent: null }, T1: { parent: null }, T2: { parent: null }, R: { parent: null } },
  joints: {
    'shoulder.r': {
      movements: {
        flexion: { bone: 'A', axis_three: [1, 0, 0] },
        horizontalAdduction: { bone: 'A', axis_three: [0, 1, 0] },
      },
    },
    breath: { movements: { 'rib1.r': { bone: 'R', axis_three: [1, 0, 0], share: 0.5 } } },
  },
  breath_max_deg: 4,
});

describe('toBonePoses', () => {
  it('turns a plain movement into a rotation about the measured axis', () => {
    const { bones } = toBonePoses({ 'elbow.r': { flexion: 90 } }, real);
    const m = real.joints['elbow.r']!.movements.flexion!;
    const q = bones[m.bone]!.quaternion;
    expect(angleOf(q)).toBeCloseTo(90);
    const n = Math.hypot(q[0], q[1], q[2]);
    [0, 1, 2].forEach((i) => expect(q[i]! / n).toBeCloseTo(m.axis_three[i]!, 3));
  });
  it('composes outermost first: horizontal adduction after flexion', () => {
    const q = toBonePoses({ 'shoulder.r': { flexion: 90, horizontalAdduction: 90 } }, tiny).bones.A!.quaternion;
    const want = mul(fromAxisVector([0, 1, 0], Math.PI / 2), fromAxisVector([1, 0, 0], Math.PI / 2));
    q.forEach((v, i) => expect(v).toBeCloseTo(want[i]!));
  });
  it('spreads upperBack evenly over T12..T1', () => {
    const { bones } = toBonePoses({ upperBack: { rotation: -24 } }, real);
    for (const b of SPREAD.upperBack!) expect(angleOf(bones[b]!.quaternion)).toBeCloseTo(2);
    expect(bones.L1).toBeUndefined();
  });
  it('turns breath into a per-rib share of breath_max_deg', () => {
    const { bones } = toBonePoses({ breath: { amount: 1 } }, tiny);
    expect(angleOf(bones.R!.quaternion)).toBeCloseTo(2);
  });
  it('breath lifts all twenty ribs in the real map, and only ribs', () => {
    const { bones } = toBonePoses({ breath: { amount: 1 } }, real);
    const names = Object.keys(bones);
    expect(names).toHaveLength(20);
    expect(names.every((n) => /^Rib\d+-Start\.[lr]$/.test(n))).toBe(true);
  });
  it('reports what the map lacks instead of failing', () => {
    expect(toBonePoses({ 'wrist.r': { flexion: 10 } }, tiny).unmapped).toEqual(['wrist.r.flexion']);
  });
  it('maps every movement the exercise catalog allows (except pelvis position)', () => {
    const missing: string[] = [];
    for (const [j, mvs] of Object.entries(JOINT_MOVEMENTS))
      for (const mv of mvs) {
        if (j === 'pelvis' && ['x', 'y', 'z'].includes(mv)) continue;
        if (toBonePoses({ [j]: { [mv]: 5 } }, real).unmapped.length) missing.push(`${j}.${mv}`);
      }
    expect(missing).toEqual([]);
  });
  it('maps every joint in the golden exercise', () => {
    const ex = parseExercise(JSON.parse(readFileSync('content/exercises/across-body-reach.json', 'utf8')));
    for (const k of ex.keyframes) expect(toBonePoses(k.pose, real).unmapped).toEqual([]);
  });
});

describe('helperPose (bands)', () => {
  it('matches Blender STRETCH_TO for every helper in the test pose', () => {
    expect(fixture.helpers.length).toBe(12);
    let worst = 0;
    for (const h of fixture.helpers) {
      const r = helperPose(
        { position: h.parent_position, quaternion: h.parent_quaternion, scale: 1 },
        { position: h.rest_local_position, quaternion: h.rest_local_quaternion },
        h.target,
        h.rest_length,
        [0, 1, 0],
        [0, 0, 1],
      );
      const world = mul(h.parent_quaternion, r.quaternion);
      for (let j = 0; j < 3; j++) {
        const e: [number, number, number] = [0, 0, 0];
        e[j] = r.scale[j]!;
        const col = rotate(world, e);
        for (let i = 0; i < 3; i++) worst = Math.max(worst, Math.abs(col[i]! - h.expected_matrix3[i]![j]!));
      }
    }
    expect(worst).toBeLessThan(1e-4);
  });
  it('is identity at rest', () => {
    const r = helperPose(
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: 1 },
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      [0, 0, -2],
      2,
      [0, 0, -1],
      [0, 1, 0],
    );
    r.quaternion.forEach((v, i) => expect(v).toBeCloseTo([0, 0, 0, 1][i]!));
    expect(r.scale).toEqual([1, 1, 1]);
  });
  it('stretches along its axis and thins on the volume axis', () => {
    const r = helperPose(
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: 1 },
      { position: [0, 0, 0], quaternion: [0, 0, 0, 1] },
      [0, 0, -3],
      2,
      [0, 0, -1],
      [0, 1, 0],
    );
    expect(r.scale[2]).toBeCloseTo(1.5);
    expect(r.scale[1]).toBeCloseTo(1 / 1.5);
    expect(r.scale[0]).toBe(1);
  });
  it('arc handles opposite vectors', () => {
    const q = arc([1, 0, 0], [-1, 0, 0]);
    rotate(q, [1, 0, 0]).forEach((v, i) => expect(v).toBeCloseTo([-1, 0, 0][i]!));
  });
});

describe('parseJointMap', () => {
  it('rejects maps with unknown bones or missing axes', () => {
    expect(() => parseJointMap({ bones: {}, joints: { a: { movements: { b: { bone: 'X', axis_three: [1, 0, 0] } } } } })).toThrow(/unknown bone/);
    expect(() => parseJointMap({ bones: { X: {} }, joints: { a: { movements: { b: { bone: 'X' } } } } })).toThrow(/axis_three/);
    expect(() => parseJointMap({ joints: {} })).toThrow(/bones/);
  });
  it('lists every rig bone, helpers included', () => {
    const b = mappedBones(real);
    expect(b).toContain('Scapula.r');
    expect(b).toContain('MH_RhomboidMajor_r_0');
    expect(real.helpers).toHaveLength(12);
  });
});
