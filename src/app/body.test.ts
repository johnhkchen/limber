/**
 * The golden exercise on the real body files, in Node: load public/anatomy/*.glb with three.js,
 * pose them through src/core exactly as the page does (body.ts), and measure what a screenshot
 * can't prove: nothing floats or explodes, the shoulder blade stays on the chest wall, and how many
 * rhomboid points end up inside a rib.
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseExercise, sample } from '../core/exercise';
import { landmark } from '../core/fk';
import { groundPose } from '../core/ground';
import { mappedBones, parseJointMap, toBonePoses } from '../core/jointmap';
import { applyPose, bindRigOnce, collectStructures, landmarkWorld, place, type Rig, type Structure } from './body';

const jm = parseJointMap(JSON.parse(readFileSync('public/anatomy/joint-map.json', 'utf8')));
// LIMBER_EXERCISE lets a tuning run point at a variant file; the committed check uses the real one.
const ex = parseExercise(JSON.parse(readFileSync(process.env.LIMBER_EXERCISE ?? 'content/exercises/across-body-reach.json', 'utf8')));

async function load(file: string): Promise<THREE.Group> {
  await MeshoptDecoder.ready;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const buf = readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return new Promise((res, rej) => loader.parse(ab, '', (g) => res(g.scene), rej));
}

let roots: THREE.Group[];
let rig: Rig;
let structures: Structure[];
const restBoneDist: number[] = [];

/** Posed world positions of every vertex of a structure (all its meshes). */
function points(zaName: string): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (const s of structures) {
    if (s.zaName !== zaName) continue;
    const m = s.mesh as THREE.SkinnedMesh;
    const pos = m.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const v = new THREE.Vector3();
      m.getVertexPosition(i, v);
      out.push(v.applyMatrix4(m.matrixWorld));
    }
  }
  return out;
}

/** Posed world positions + normals of a rigid (one-bone) structure. */
function rigidPointsNormals(zaName: string): { p: THREE.Vector3[]; n: THREE.Vector3[] } {
  const p: THREE.Vector3[] = [];
  const n: THREE.Vector3[] = [];
  const bm = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  for (const s of structures) {
    if (s.zaName !== zaName) continue;
    const m = s.mesh as THREE.SkinnedMesh;
    const pos = m.geometry.getAttribute('position');
    const nor = m.geometry.getAttribute('normal');
    const j = m.geometry.getAttribute('skinIndex').getX(0);
    bm.multiplyMatrices(m.skeleton.bones[j]!.matrixWorld, m.skeleton.boneInverses[j]!).multiply(m.bindMatrix);
    nm.getNormalMatrix(bm);
    for (let i = 0; i < pos.count; i++) {
      p.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(bm));
      n.push(new THREE.Vector3().fromBufferAttribute(nor, i).applyMatrix3(nm).normalize());
    }
  }
  return { p, n };
}

/** Tiny spatial hash for nearest-point queries. */
function grid(pts: THREE.Vector3[], cell = 0.01) {
  const map = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  pts.forEach((p, i) => {
    const k = key(p.x, p.y, p.z);
    const l = map.get(k) ?? [];
    l.push(i);
    map.set(k, l);
  });
  return (q: THREE.Vector3, r: number): { i: number; d: number } => {
    let best = { i: -1, d: Infinity };
    const c = Math.ceil(r / cell);
    const [cx, cy, cz] = [Math.floor(q.x / cell), Math.floor(q.y / cell), Math.floor(q.z / cell)];
    for (let dx = -c; dx <= c; dx++)
      for (let dy = -c; dy <= c; dy++)
        for (let dz = -c; dz <= c; dz++)
          for (const i of map.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            const d = q.distanceTo(pts[i]!);
            if (d < best.d) best = { i, d };
          }
    return best;
  };
}

const RIBS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth', 'Eleventh', 'Twelfth'].map((n) => `${n} rib.r`);

function poseAt(t: number) {
  applyPose(rig, toBonePoses(sample(ex, t).pose, jm));
  for (const r of roots) r.updateMatrixWorld(true);
}

function measure() {
  const ribs = RIBS.map(rigidPointsNormals);
  const ribP = ribs.flatMap((r) => r.p);
  const ribN = ribs.flatMap((r) => r.n);
  const nearRib = grid(ribP);
  // shoulder blade to chest wall: closest scapula point to any right rib
  let gap = Infinity;
  const scap = rigidPointsNormals('Scapula.r').p;
  for (const v of scap) gap = Math.min(gap, nearRib(v, 0.03).d);
  // how far the blade sits from the spine: scapula centroid to the T4 vertebra centroid, sideways + front/back
  const c = (ps: THREE.Vector3[]) => ps.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(ps.length);
  const sc = c(scap), t4 = c(rigidPointsNormals('Vertebra T4').p);
  const bladeFromSpine = Math.hypot(sc.x - t4.x, sc.z - t4.z);
  // rhomboid points inside a rib: nearest rib point within 6 mm and on the inner side of its surface
  const rh = points('Rhomboid major muscle.r');
  let inside = 0;
  for (const v of rh) {
    const q = nearRib(v, 0.006);
    if (q.i >= 0 && q.d < 0.006 && v.clone().sub(ribP[q.i]!).dot(ribN[q.i]!) < 0) inside++;
  }
  // floating / exploding: every muscle point should stay near some bone
  const bones = structures.filter((s) => s.layer === 'skeleton').map((s) => s.zaName);
  const boneP = [...new Set(bones)].flatMap((b) => rigidPointsNormals(b).p);
  const nearBone = grid(boneP, 0.02);
  const first = !restBoneDist.length;
  let far = 0;
  let k = 0;
  let nan = 0;
  const muscles = [...new Set(structures.filter((s) => s.layer === 'muscles').map((s) => s.zaName))];
  let total = 0;
  for (const m of muscles)
    for (const v of points(m)) {
      total++;
      const i = k++;
      if (!Number.isFinite(v.x + v.y + v.z)) { nan++; continue; }
      const d = Math.min(nearBone(v, 0.08).d, 0.08);
      if (first) restBoneDist[i] = d;
      else if (d - restBoneDist[i]! > 0.02) far++; // drifted 2 cm further from every bone than at REST
    }
  return { gapMm: +(gap * 1000).toFixed(1), bladeFromSpineMm: +(bladeFromSpine * 1000).toFixed(1), rhomboidInsideRib: inside, rhomboidVerts: rh.length, farFromBone: far, nan, muscleVerts: total };
}

beforeAll(async () => {
  roots = [await load('public/anatomy/skeleton.glb'), await load('public/anatomy/muscles.glb')];
  structures = [...collectStructures(roots[0]!, 'skeleton'), ...collectStructures(roots[1]!, 'muscles')];
  rig = bindRigOnce(roots, mappedBones(jm), jm.helpers ?? []);
  holder = new THREE.Group();
  holder.add(...roots);
}, 30000);

let holder: THREE.Group;

describe('across-body reach on the real body', () => {
  it('lights up structures that exist', () => {
    const names = new Set(structures.map((s) => s.zaName));
    for (const h of ex.highlight) expect(names, h).toContain(h);
  });

  it('binds every rig bone and all helpers in both files', () => {
    expect(rig.copies.size).toBe(Object.keys(jm.bones).length);
    expect(rig.helpers.length).toBe(2 * (jm.helpers ?? []).length);
  });

  it('keeps the body together at REST, mid-reach, full reach and top of a breath', () => {
    const rows: Record<string, ReturnType<typeof measure>> = {};
    const hold = ex.hold!;
    for (const [name, t] of [['rest', 0], ['mid', 1.8], ['full', hold.from + 0.01], ['breathIn', hold.from + hold.breathSeconds / 2]] as const) {
      poseAt(t);
      rows[name] = measure();
    }
    console.log('POSECHECK', JSON.stringify(rows));
    for (const r of Object.values(rows)) {
      expect(r.nan).toBe(0);
      expect(r.farFromBone).toBe(0);
    }
    // the blade may glide but must not sink into the ribs or float far off them
    expect(rows.full!.gapMm).toBeGreaterThan(0.5);
    expect(rows.full!.gapMm).toBeLessThan(25);
    // the point of the move: the blade slides outward, away from the spine
    expect(rows.full!.bladeFromSpineMm - rows.rest!.bladeFromSpineMm).toBeGreaterThan(15);
    // no rhomboid point inside a rib in this pose (the bands spike saw 18 at a stronger pose)
    expect(rows.full!.rhomboidInsideRib).toBe(0);
    poseAt(0);
  }, 60000);

  it('draws the body where core says it is: landmarks within 2 mm of core FK, grounded and placed', () => {
    const names = ['palm.r', 'fingertips.r', 'elbow.r', 'shoulder.r', 'back.r', 'back', 'forehead', 'heel.l', 'toes.r', 'knee.l'];
    const hold = ex.hold!;
    let worst = 0;
    for (const t of [0, 1.8, hold.from + 0.01, hold.from + hold.breathSeconds / 2]) {
      const g = groundPose(ex, t, jm);
      place(holder, g.transform);
      applyPose(rig, g.bones);
      holder.updateMatrixWorld(true);
      for (const n of names) {
        const core = landmark(g.posed, jm, n)!;
        const drawn = landmarkWorld(rig, jm, n)!;
        expect(core, n).not.toBeNull();
        expect(drawn, n).not.toBeNull();
        worst = Math.max(worst, drawn.distanceTo(new THREE.Vector3(...core)));
      }
    }
    console.log('LANDMARK worst mm', (worst * 1000).toFixed(3));
    expect(worst).toBeLessThan(0.002);
    place(holder, null);
    poseAt(0);
  });
});
