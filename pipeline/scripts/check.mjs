// Round-trip check: load the packed GLBs the way the app will (three.js GLTFLoader + MeshoptDecoder),
// in Node, and assert the contract the app relies on. Writes <out>/check.json. Exit 1 on any failure.
//
//   node pipeline/scripts/check.mjs pipeline/out
//
// What it asserts
//   - both files carry the same skeleton, and its bone names == joint-map.json (exact names via
//     userData.name; three's sanitized .name == joint-map three_name)
//   - every structure node has userData.za_name, every mesh belongs to one
//   - <= 4 influences, weights sum to 1, joint indices in range; skeleton meshes use exactly 1 bone
//   - nothing on the licence deny list got in
//   - facing: after glTF's Y-up conversion three sees up = +Y, anterior (the body faces) = +Z, subject left = +X
//   - bone rest frames == joint-map rest_axes mapped with C: (x,y,z) -> (x,z,-y)
//   - posing through joint-map axis_three moves the right elbow forward for shoulder flexion
//   - sizes raw / packed / brotli and triangle counts
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

const OUT = path.resolve(process.argv[2] || 'pipeline/out');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const jm = JSON.parse(fs.readFileSync(path.join(OUT, 'joint-map.json'), 'utf8'));
const deny = JSON.parse(fs.readFileSync(path.join(HERE, '..', 'data', 'deny.json'), 'utf8'));
const denyRe = deny.patterns.map((p) => new RegExp(p, 'i'));

const fails = [];
const ok = (cond, msg) => { if (!cond) fails.push(msg); return cond; };
const br = (buf) => zlib.brotliCompressSync(buf, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 } }).length;

await MeshoptDecoder.ready;
const loader = new GLTFLoader();
loader.setMeshoptDecoder(MeshoptDecoder);
const load = (file) => new Promise((res, rej) => {
  const buf = fs.readFileSync(file);
  loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '', res, rej);
});

const C = (v) => new THREE.Vector3(v[0], v[2], -v[1]); // Blender (Z-up) -> glTF/three (Y-up)
const structuresOf = (gltf) => { // za_name -> meshes (bind-pose geometry; skeleton meshes are bound at REST with identity bind)
  const out = {};
  gltf.scene.traverse((o) => { if (!o.isMesh) return; const s = o.userData.za_name ? o : o.parent?.userData.za_name ? o.parent : null; if (s) (out[s.userData.za_name] ??= []).push(o); });
  return out;
};
const report = { files: {}, facing: {}, axes: {}, pose_test: {} };
const loaded = {};

for (const layer of ['skeleton', 'muscles']) {
  const packed = path.join(OUT, `${layer}.glb`);
  const raw = path.join(OUT, `${layer}.raw.glb`);
  const pbuf = fs.readFileSync(packed);
  const gltf = await load(packed);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  loaded[layer] = gltf;

  // ---- bones
  const bones = [];
  scene.traverse((o) => { if (o.isBone) bones.push(o); });
  const exact = bones.map((b) => b.userData.name);
  const want = Object.keys(jm.bones);
  ok(bones.length === want.length, `${layer}: ${bones.length} bones, joint-map has ${want.length}`);
  const missing = want.filter((n) => !exact.includes(n));
  const extra = exact.filter((n) => !want.includes(n));
  ok(!missing.length && !extra.length, `${layer}: bone names differ from joint-map (missing ${missing.slice(0, 5)}, extra ${extra.slice(0, 5)})`);
  const badThree = bones.filter((b) => jm.bones[b.userData.name] && jm.bones[b.userData.name].three_name !== b.name);
  ok(!badThree.length, `${layer}: three names differ from joint-map three_name: ${badThree.slice(0, 5).map((b) => b.userData.name + '->' + b.name)}`);
  for (const b of bones) {
    const p = jm.bones[b.userData.name]?.parent ?? null;
    const actual = b.parent?.isBone ? b.parent.userData.name : null;
    ok(p === actual, `${layer}: ${b.userData.name} parent ${actual} != joint-map ${p}`);
  }

  // ---- structures and meshes
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const owner = (m) => (m.userData.za_name ? m : m.parent?.userData.za_name ? m.parent : null);
  const structures = new Map();
  let tris = 0, maxInf = 0, maxSumErr = 0, badIdx = 0, skinned = 0, onMeshNode = 0;
  for (const m of meshes) {
    const s = owner(m);
    ok(!!s, `${layer}: mesh ${m.name} has no extras.za_name on itself or its parent`);
    if (!s) continue;
    if (s === m) onMeshNode++;
    if (!structures.has(s.userData.za_name)) structures.set(s.userData.za_name, { node: s, meshes: [] });
    structures.get(s.userData.za_name).meshes.push(m);
    ok(!denyRe.some((r) => r.test(s.userData.za_name)), `${layer}: deny-listed structure ${s.userData.za_name}`);
    if (m.isSkinnedMesh) skinned++;
    const g = m.geometry;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    ok(si && sw && si.itemSize === 4 && sw.itemSize === 4, `${layer}: ${m.name} missing 4-wide skin attributes`);
    const nb = m.skeleton.bones.length;
    const used = new Set();
    for (let i = 0; i < sw.count; i++) {
      let s4 = 0, n = 0;
      for (let k = 0; k < 4; k++) {
        const w = sw.getComponent(i, k);
        if (w > 1e-4) { n++; used.add(si.getComponent(i, k)); if (si.getComponent(i, k) >= nb) badIdx++; }
        s4 += w;
      }
      maxInf = Math.max(maxInf, n); maxSumErr = Math.max(maxSumErr, Math.abs(s4 - 1));
    }
    if (layer === 'skeleton') {
      const b = [...used].map((i) => m.skeleton.bones[i].userData.name);
      ok(b.length === 1 && b[0] === s.userData.za_bone, `${layer}: ${s.userData.za_name} bound to ${b} not ${s.userData.za_bone}`);
    }
  }
  ok(skinned === meshes.length, `${layer}: ${meshes.length - skinned} meshes are not SkinnedMesh`);
  ok(maxInf <= 4, `${layer}: ${maxInf} influences`);
  ok(maxSumErr < 0.01, `${layer}: weight sum off by ${maxSumErr}`);
  ok(badIdx === 0, `${layer}: ${badIdx} joint indices out of range`);
  // one shared skeleton per file
  const skels = new Set(meshes.map((m) => m.skeleton));
  ok(skels.size === 1, `${layer}: ${skels.size} skeletons`);

  report.files[layer] = {
    raw_bytes: fs.statSync(raw).size, raw_brotli: br(fs.readFileSync(raw)),
    packed_bytes: pbuf.length, packed_brotli: br(pbuf),
    structures: structures.size, three_meshes: meshes.length, structures_with_za_on_mesh_itself: onMeshNode,
    triangles: tris, bones: bones.length, max_influences: maxInf, max_weight_sum_err: +maxSumErr.toFixed(5),
    skeletons: skels.size,
  };
  report.files[layer].structure_names = [...structures.keys()].sort();
}

// ---- same skeleton in both files, same order
const order = (g) => { const s = []; g.scene.traverse((o) => { if (o.isSkinnedMesh && !s.length) s.push(...o.skeleton.bones.map((b) => b.userData.name)); }); return s; };
const o1 = order(loaded.skeleton), o2 = order(loaded.muscles);
ok(o1.length === o2.length && o1.every((n, i) => n === o2[i]), 'skeleton.glb and muscles.glb skin joint order differs');
report.shared_joint_order = o1.length === o2.length && o1.every((n, i) => n === o2[i]);

// ---- facing, from world-space skinned vertices at rest
const centroid = (layer, name) => {
  let s = null;
  loaded[layer].scene.traverse((o) => { if (o.userData.za_name === name) s = o; });
  const c = new THREE.Vector3(), v = new THREE.Vector3(); let n = 0;
  s.traverse((m) => {
    if (!m.isSkinnedMesh) return;
    m.skeleton.update();
    for (let i = 0; i < m.geometry.attributes.position.count; i++) {
      m.getVertexPosition(i, v); v.applyMatrix4(m.matrixWorld); c.add(v); n++;
    }
  });
  return c.divideScalar(n);
};
const sternum = centroid('skeleton', 'Body of sternum');
const t6 = centroid('skeleton', 'Vertebra T6');
const hipL = centroid('skeleton', 'Hip bone.l');
const hipR = centroid('skeleton', 'Hip bone.r');
const c7 = centroid('skeleton', 'Vertebra C7');
const sacrum = centroid('skeleton', 'Sacrum');
const rhomb = centroid('muscles', 'Rhomboid major muscle.r');
const fwd = sternum.clone().sub(t6).normalize();
const left = hipL.clone().sub(hipR).normalize();
const up = c7.clone().sub(sacrum).normalize();
const r3 = (v) => v.toArray().map((x) => +x.toFixed(3));
report.facing = {
  anterior_three: r3(fwd), subject_left_three: r3(left), up_three: r3(up),
  sternum_centroid_three: r3(sternum), rhomboid_major_r_centroid_three: r3(rhomb),
  summary: 'three.js: +Y up, body faces +Z, subject left +X (right side is -X). Blender/Z-Anatomy -Y anterior becomes +Z.',
};
ok(fwd.z > 0.9, `body should face +Z in three, got ${r3(fwd)}`);
ok(left.x > 0.9, `subject left should be +X in three, got ${r3(left)}`);
ok(up.y > 0.9, `up should be +Y in three, got ${r3(up)}`);
ok(rhomb.x < 0 && rhomb.z < t6.z, `right rhomboid should sit at -X behind the spine, got ${r3(rhomb)}`);

// ---- rest frames vs joint-map (bone world rotation in three == C . R_blender)
let maxAxisDeg = 0, maxHeadMm = 0, worstAxis = '';
const bonesByName = {};
loaded.muscles.scene.traverse((o) => { if (o.isBone) bonesByName[o.userData.name] = o; });
const e = new THREE.Vector3(), q = new THREE.Quaternion(), pos = new THREE.Vector3();
for (const [name, b] of Object.entries(bonesByName)) {
  b.getWorldQuaternion(q); b.getWorldPosition(pos);
  const j = jm.bones[name];
  maxHeadMm = Math.max(maxHeadMm, pos.distanceTo(C(j.head)) * 1000);
  for (const [k, basis] of [['x', [1, 0, 0]], ['y', [0, 1, 0]], ['z', [0, 0, 1]]]) {
    e.set(...basis).applyQuaternion(q);
    const d = THREE.MathUtils.radToDeg(e.angleTo(C(j.rest_axes[k])));
    if (d > maxAxisDeg) { maxAxisDeg = d; worstAxis = `${name}.${k}`; }
  }
}
report.axes = { max_rest_axis_error_deg: +maxAxisDeg.toFixed(4), worst: worstAxis, max_head_error_mm: +maxHeadMm.toFixed(4),
  meaning: 'three bone-local frame == Blender bone-local frame (world converted by C), so joint-map axis_three == axis_local' };
ok(maxAxisDeg < 0.05, `bone rest axes differ from joint-map by ${maxAxisDeg} deg (${worstAxis})`);
ok(maxHeadMm < 0.05, `bone heads differ from joint-map by ${maxHeadMm} mm`);

// ---- pose through joint-map: shoulder.r flexion 90 -> elbow goes forward (+Z) and up
{
  const arm = bonesByName['RightArm'], fore = bonesByName['RightForeArm'];
  const before = fore.getWorldPosition(new THREE.Vector3());
  const ax = new THREE.Vector3(...jm.joints['shoulder.r'].movements.flexion.axis_three).normalize();
  const rest = arm.quaternion.clone();
  arm.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(ax, Math.PI / 2));
  arm.updateMatrixWorld(true);
  const after = fore.getWorldPosition(new THREE.Vector3());
  arm.quaternion.copy(rest); arm.updateMatrixWorld(true);
  const d = after.clone().sub(before);
  report.pose_test = { move: 'shoulder.r flexion +90 via axis_three', elbow_delta_three_m: r3(d) };
  ok(d.z > 0.15 && d.y > 0.1, `shoulder flexion should move the elbow forward (+Z) and up (+Y), got ${r3(d)}`);
}

// ---- horizontal adduction after flexion: the elbow must cross toward the subject's left (+X).
// (Flexion alone can't catch a wrong axis convention: its axis is near local X either way.)
{
  const arm = bonesByName['RightArm'], fore = bonesByName['RightForeArm'];
  const mv = jm.joints['shoulder.r'].movements;
  const rest = arm.quaternion.clone();
  const q = (m, deg) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...m.axis_three).normalize(), THREE.MathUtils.degToRad(deg));
  arm.quaternion.copy(rest).multiply(q(mv.flexion, 90)); arm.updateMatrixWorld(true);
  const a = fore.getWorldPosition(new THREE.Vector3());
  arm.quaternion.copy(rest).multiply(q(mv.horizontalAdduction, 40)).multiply(q(mv.flexion, 90)); arm.updateMatrixWorld(true);
  const b = fore.getWorldPosition(new THREE.Vector3());
  arm.quaternion.copy(rest); arm.updateMatrixWorld(true);
  report.pose_test.hadd_elbow_delta_three_m = r3(b.clone().sub(a));
  ok(b.x - a.x > 0.1, `shoulder.r horizontalAdduction 40 (after flexion 90) should move the elbow toward +X, got ${r3(b.clone().sub(a))}`);
  let maxDiff = 0;
  for (const j of Object.values(jm.joints)) for (const m of Object.values(j.movements))
    maxDiff = Math.max(maxDiff, ...m.axis_three.map((v, i) => Math.abs(v - m.axis_local[i])));
  ok(maxDiff < 1e-6, `axis_three should equal axis_local (bone-local frames are unchanged by the export), max diff ${maxDiff}`);
}

// ---- pose probe: the same compound pose in three.js as joints.py posed in Blender; tails must agree
{
  const pp = jm.pose_probe;
  const rest = new Map(Object.values(bonesByName).map((b) => [b, b.quaternion.clone()]));
  const per = {};
  for (const [jn, mvs] of Object.entries(pp.pose)) for (const [mv, deg] of Object.entries(mvs)) {
    const j = jm.joints[jn];
    if (j.amount_max_deg && mv === 'amount') { // shared movement (grip): every entry turns by amount * share * max
      for (const m of Object.values(j.movements)) (per[m.bone] ??= []).push([pp.order.indexOf('amount'), m.axis_three, deg * m.share * j.amount_max_deg]);
      continue;
    }
    const m = j.movements[mv];
    (per[m.bone] ??= []).push([pp.order.indexOf(mv), m.axis_three, deg]);
  }
  for (const [b, lst] of Object.entries(per)) {
    lst.sort((x, y) => x[0] - y[0]);
    for (const [, ax, deg] of lst) bonesByName[b].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...ax).normalize(), THREE.MathUtils.degToRad(deg)));
  }
  loaded.muscles.scene.updateMatrixWorld(true);
  let worst = 0;
  for (const [b, t] of Object.entries(pp.tails_blender)) {
    const tail = new THREE.Vector3(0, jm.bones[b].length, 0).applyMatrix4(bonesByName[b].matrixWorld);
    worst = Math.max(worst, tail.distanceTo(C(t)) * 1000);
  }
  for (const [b, q] of rest) b.quaternion.copy(q);
  loaded.muscles.scene.updateMatrixWorld(true);
  report.pose_test.probe_max_tail_gap_mm = +worst.toFixed(4);
  report.pose_test.probe_bones = Object.keys(pp.tails_blender).length;
  ok(worst < 0.5, `three.js and Blender disagree on the probe pose by ${worst.toFixed(2)} mm`);
}

// ---- single movements do what their names say, in three.js world space (+Y up, +Z front, +X subject left)
{
  const tailW = (b) => new THREE.Vector3(0, jm.bones[b].length, 0).applyMatrix4(bonesByName[b].matrixWorld);
  const moveTest = (joint, mv, deg, probeBone, expect, label) => {
    const m = jm.joints[joint].movements[mv];
    const bone = bonesByName[m.bone];
    loaded.muscles.scene.updateMatrixWorld(true);
    const a = tailW(probeBone);
    const rest = bone.quaternion.clone();
    bone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...m.axis_three).normalize(), THREE.MathUtils.degToRad(deg)));
    loaded.muscles.scene.updateMatrixWorld(true);
    const d = tailW(probeBone).sub(a);
    bone.quaternion.copy(rest); loaded.muscles.scene.updateMatrixWorld(true);
    report.pose_test[label] = r3(d);
    ok(expect(d), `${joint}.${mv} ${deg} should ${label}, got ${r3(d)}`);
  };
  for (const s of ['r', 'l']) {
    const S = s === 'r' ? 'Right' : 'Left', lat = s === 'r' ? -1 : 1;
    moveTest(`hip.${s}`, 'flexion', 90, `${S}UpLeg`, (d) => d.z > 0.25 && d.y > 0.2, `hip.${s} flexion: knee forward+up`);
    moveTest(`knee.${s}`, 'flexion', 90, `${S}Leg`, (d) => d.z < -0.25 && d.y > 0.2, `knee.${s} flexion: ankle back+up`);
    moveTest(`hip.${s}`, 'abduction', 30, `${S}UpLeg`, (d) => d.x * lat > 0.1, `hip.${s} abduction: knee out`);
    moveTest(`ankle.${s}`, 'dorsiflexion', 20, 'Distal phalanx of foot-1st finger.' + s, (d) => d.y > 0.02, `ankle.${s} dorsiflexion: toes up`);
    moveTest(`shoulder.${s}`, 'flexion', 90, `${S}Arm`, (d) => d.z > 0.15 && d.y > 0.1, `shoulder.${s} flexion: elbow forward+up`);
    moveTest(`shoulder.${s}`, 'abduction', 90, `${S}Arm`, (d) => d.x * lat > 0.15 && d.y > 0.1, `shoulder.${s} abduction: elbow out+up`);
    moveTest(`elbow.${s}`, 'flexion', 90, 'Radius.' + s, (d) => d.z > 0.15, `elbow.${s} flexion: wrist forward`);
    moveTest(`shoulderGirdle.${s}`, 'elevation', 20, 'Clavicle-X.' + s, (d) => d.y > 0.01, `shoulderGirdle.${s} elevation: clavicle end up`);
    moveTest(`scapula.${s}`, 'upwardRotation', 20, `${S}Arm`, (d) => d.x * lat > 0 || d.y > 0, `scapula.${s} upwardRotation: shoulder joint out/up`);
  }
  // grip closes the hand: fingertips come toward the palm (forward, +Z, and up) and the thumb tip swings medially
  for (const s of ['r', 'l']) {
    const g = jm.joints[`grip.${s}`];
    ok(g && g.amount_max_deg > 0 && Object.keys(g.movements).length === 15, `grip.${s} should have 15 entries (4 fingers x 3 + thumb x 3)`);
    const rest = new Map(Object.values(bonesByName).map((b) => [b, b.quaternion.clone()]));
    loaded.muscles.scene.updateMatrixWorld(true);
    const tips = ['1st', '2nd', '3rd', '4th', '5th'].map((n) => `Distal phalanx of hand-${n} finger.${s}`);
    const before = tips.map(tailW);
    for (const m of Object.values(g.movements))
      bonesByName[m.bone].quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...m.axis_three).normalize(), THREE.MathUtils.degToRad(m.share * g.amount_max_deg)));
    loaded.muscles.scene.updateMatrixWorld(true);
    const d = tips.map((t, i) => tailW(t).sub(before[i]));
    for (const [b, q] of rest) b.quaternion.copy(q);
    loaded.muscles.scene.updateMatrixWorld(true);
    // palm centre: 60% down the third metacarpal, 2 cm in front of it (palms face forward, +Z, at REST)
    const mc = `Metacarpal bone-3rd finger.${s}`;
    const palm = bonesByName[mc].getWorldPosition(new THREE.Vector3()).lerp(tailW(mc), 0.6).add(new THREE.Vector3(0, 0, 0.02));
    const after = before.map((v, i) => v.clone().add(d[i]));
    const ratio = after.map((v, i) => v.distanceTo(palm) / before[i].distanceTo(palm));
    report.pose_test[`grip.${s} tip deltas (thumb..little)`] = d.map(r3);
    report.pose_test[`grip.${s} tip-to-palm distance ratio (thumb..little)`] = ratio.map((x) => +x.toFixed(2));
    ok(d.slice(1).every((v) => v.y > 0.03) && ratio.slice(1).every((x) => x < 0.6), `grip.${s}: finger tips should rise and close on the palm, got ${d.slice(1).map(r3)} ratios ${ratio.slice(1).map((x) => x.toFixed(2))}`);
    const lat = s === 'r' ? -1 : 1;
    ok(d[0].x * lat < 0, `grip.${s}: thumb tip should swing medially, got ${r3(d[0])}`);
  }
}

// ---- mirrored (.l) bones kept outward winding. The full file's .l bones are negative-scale mirror copies; a wrong
// fix shows up as a negative enclosed volume (triangles wound inward) or normals that disagree with the winding.
{
  const rows = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), cc = new THREE.Vector3(), fn = new THREE.Vector3(), vn = new THREE.Vector3(), t = new THREE.Vector3();
  for (const [name, entry] of Object.entries(structuresOf(loaded.skeleton))) {
    if (!/\.(l|r)$/.test(name)) continue;
    let vol = 0, agree = 0, tris = 0;
    for (const m of entry) {
      const g = m.geometry, p = g.attributes.position, no = g.attributes.normal, idx = g.index;
      const nt = idx ? idx.count / 3 : p.count / 3;
      for (let k = 0; k < nt; k++) {
        const i = idx ? [idx.getX(3 * k), idx.getX(3 * k + 1), idx.getX(3 * k + 2)] : [3 * k, 3 * k + 1, 3 * k + 2];
        a.fromBufferAttribute(p, i[0]); b.fromBufferAttribute(p, i[1]); cc.fromBufferAttribute(p, i[2]);
        vol += a.dot(t.copy(b).cross(cc)) / 6;
        fn.copy(b).sub(a).cross(t.copy(cc).sub(a));
        vn.fromBufferAttribute(no, i[0]).add(t.fromBufferAttribute(no, i[1])).add(t.fromBufferAttribute(no, i[2]));
        if (fn.lengthSq() > 0) { agree += fn.dot(vn) > 0 ? 1 : 0; tris++; }
      }
    }
    rows.push({ name, signed_volume_cm3: +(vol * 1e6).toFixed(2), normals_agree_frac: +(agree / Math.max(tris, 1)).toFixed(3) });
  }
  const bad = rows.filter((r) => r.signed_volume_cm3 <= 0 || r.normals_agree_frac < 0.9);
  const pairs = rows.filter((r) => r.name.endsWith('.l')).map((r) => {
    const R = rows.find((x) => x.name === r.name.slice(0, -2) + '.r');
    return R ? Math.abs(r.signed_volume_cm3 - R.signed_volume_cm3) / Math.max(R.signed_volume_cm3, 1e-9) : 0;
  });
  report.winding = { checked: rows.length, bad, worst_normals: [...rows].sort((x, y) => x.normals_agree_frac - y.normals_agree_frac).slice(0, 3),
    max_left_right_volume_diff_frac: +Math.max(0, ...pairs).toFixed(3) };
  ok(!bad.length, `inward-wound or flipped-normal sided bones: ${bad.map((r) => `${r.name} (${r.signed_volume_cm3} cm3, ${r.normals_agree_frac})`).slice(0, 8)}`);
}

// ---- budget: packed + brotli of everything the app downloads
{
  const jmBr = br(fs.readFileSync(path.join(OUT, 'joint-map.json')));
  const total = report.files.skeleton.packed_brotli + report.files.muscles.packed_brotli + jmBr;
  report.budget = { joint_map_brotli: jmBr, total_brotli: total, cap_brotli: 2 * 1024 * 1024 };
  ok(total < 2 * 1024 * 1024, `download is ${total} bytes brotli, over the 2 MB budget`);
}

// ---- joint-map joints point at real bones
for (const [k, j] of Object.entries(jm.joints)) for (const [mv, m] of Object.entries(j.movements)) ok(bonesByName[m.bone], `joint ${k}.${mv} -> missing bone ${m.bone}`);

report.fails = fails;
report.ok = fails.length === 0;
fs.writeFileSync(path.join(OUT, 'check.json'), JSON.stringify(report, null, 1));
const f = report.files;
for (const l of Object.keys(f)) console.log(`CHK ${l}: ${f[l].structures} structures, ${f[l].three_meshes} three meshes, ${f[l].triangles} tris, ${f[l].bones} bones, raw ${f[l].raw_bytes} (br ${f[l].raw_brotli}) -> packed ${f[l].packed_bytes} (br ${f[l].packed_brotli}), max inf ${f[l].max_influences}`);
console.log('CHK facing', JSON.stringify(report.facing));
console.log('CHK axes', JSON.stringify(report.axes));
console.log('CHK pose', JSON.stringify(report.pose_test));
console.log('CHK winding', JSON.stringify({ checked: report.winding?.checked, bad: report.winding?.bad?.length, worst: report.winding?.worst_normals, lr_vol_diff: report.winding?.max_left_right_volume_diff_frac }));
console.log('CHK budget', JSON.stringify(report.budget));
if (fails.length) { console.error('CHK FAIL\n  ' + fails.join('\n  ')); process.exit(1); }
console.log('CHK OK');
