"""Step 1: flatten the Z-Biomechanics rig into a plain FK parent chain.

Run:  Blender -b pipeline/source/Z-Biomechanics/Startup.blend --python pipeline/scripts/rig.py -- <out_dir>

What it does (see docs/knowledge/anatomy-pipeline.md, "Constraints don't travel"):
  1. Forces REST (clears the leftover frame-61 pose, drops the action).
  2. Deletes the AnatPoseToTPose / TPoseToAnatPose helper armatures.
  3. Deletes every driver and every bone constraint.
  4. Re-parents the parentless vertebrae into one chain Hips -> L5 .. L1 -> T12 .. T1 -> C7 .. C1 -> Head,
     hangs radius/ulna off the elbow bone (RightForeArm), the carpals off the wrist bone (RightHand),
     the tibia off the knee bone (RightLeg), and deletes the control / helper bones the constraints used.
  5. Checks the REST head/tail/roll of every kept bone is unchanged, and that the identity pose == REST.
  6. Saves <out_dir>/rig.blend (armature + the rig file's own bone meshes, still bone-parented) and
     <out_dir>/rig-report.json. Bone names are kept exactly as in the rig file (design: "Keep the rig
     file's bone names exactly").
"""
import bpy, sys, json, os, math
from mathutils import Matrix

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'pipeline/out'
os.makedirs(OUT, exist_ok=True)

def log(*a):
    print('RIG', *a, flush=True)

arm = bpy.data.objects['Armature']

# ---------------------------------------------------------------- 1. REST
arm.data.pose_position = 'REST'
if arm.animation_data:
    arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
    pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    pb.rotation_axis_angle = (0, 0, 1, 0)
bpy.context.view_layer.update()

# ---------------------------------------------------------------- 2. helper armatures
for n in ('AnatPoseToTPose', 'TPoseToAnatPose'):
    o = bpy.data.objects.get(n)
    if o:
        bpy.data.objects.remove(o, do_unlink=True)
log('armatures left', [o.name for o in bpy.data.objects if o.type == 'ARMATURE'])

# ---------------------------------------------------------------- 3. drivers + constraints
n_drv = 0
for coll in (bpy.data.objects, bpy.data.armatures, bpy.data.meshes, bpy.data.shape_keys,
             bpy.data.scenes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    for idb in coll:
        ad = getattr(idb, 'animation_data', None)
        if ad:
            for fc in list(ad.drivers):
                ad.drivers.remove(fc); n_drv += 1
            ad.action = None
limits = {}
for pb in arm.pose.bones:     # the rig's own limits become the clamps in src/core/ (kept in joint-map.json)
    for c in pb.constraints:
        if c.type == 'LIMIT_ROTATION' and c.owner_space == 'LOCAL' and c.influence > 0:
            L = {}
            for ax in 'xyz':
                if getattr(c, 'use_limit_' + ax):
                    L[ax] = [round(math.degrees(getattr(c, 'min_' + ax)), 2), round(math.degrees(getattr(c, 'max_' + ax)), 2)]
            if L:
                limits[pb.name] = L
            break
n_con = 0
for pb in arm.pose.bones:
    for c in list(pb.constraints):
        pb.constraints.remove(c); n_con += 1
for o in bpy.data.objects:
    for c in list(o.constraints):
        o.constraints.remove(c); n_con += 1
log('deleted drivers', n_drv, 'constraints', n_con)

# ---------------------------------------------------------------- 3b. knee pivot (measured)
# The source knee is a constraint + driver mechanism (Knee / Knee-Flexion damped tracks, drivers that slide the
# tibia and turn the patella as the knee bends). Flattened to one hinge at the RightLeg head (5-6 cm above the
# joint line), a 90 deg bend opened a ~78 mm gap between femur and tibia. So we move each knee bone's head (the
# hinge) to the point in the sagittal plane that keeps the tibial plateau on the femoral condyles best over
# 0-150 deg of flexion (grid search, 5 mm then 1 mm, on the rig file's own femur/tibia meshes, which match the full
# file's exactly). Tail kept, so the bone and its REST children do not move; only the hinge does.
from mathutils import Vector as _V
from mathutils.bvhtree import BVHTree as _BVH
import numpy as _np

def _rest_mesh(name):
    o = bpy.data.objects[name]
    dg_ = bpy.context.evaluated_depsgraph_get()
    oe = o.evaluated_get(dg_); me = oe.to_mesh(); me.calc_loop_triangles()
    V = _np.array([tuple(oe.matrix_world @ v.co) for v in me.vertices])
    flip = oe.matrix_world.to_3x3().determinant() < 0       # mirrored copies: keep normals outward
    T = [tuple(t.vertices)[::-1] if flip else tuple(t.vertices) for t in me.loop_triangles]
    oe.to_mesh_clear()
    return V, T

KNEE_ANGLES = [math.radians(a) for a in range(0, 151, 15)]

def knee_pivot(side, head):
    F, FT = _rest_mesh('Femur.' + side)
    Tb, _ = _rest_mesh('Tibia.' + side)
    P, _ = _rest_mesh('Patella.' + side)
    bvh = _BVH.FromPolygons([tuple(v) for v in F], FT)
    top = Tb[:, 2].max()
    plateau = Tb[Tb[:, 2] > top - 0.025]
    plateau = plateau[_np.linspace(0, len(plateau) - 1, min(400, len(plateau))).astype(int)]
    def sd(Q):
        out = _np.empty(len(Q))
        for i, q in enumerate(Q):
            loc, n, _, d = bvh.find_nearest(_V(q)); out[i] = d if (_V(q) - loc).dot(n) >= 0 else -d
        return out
    def rot(Q, y, z, th):          # flexion about world +X through (y, z): the shank swings posteriorly (+Y)
        c, sn = math.cos(th), math.sin(th); R = Q.copy(); dy = Q[:, 1] - y; dz = Q[:, 2] - z
        R[:, 1] = y + dy * c - dz * sn; R[:, 2] = z + dy * sn + dz * c; return R
    def contact(y, z, Q=plateau):
        return [float(sd(rot(Q, y, z, th)).min()) for th in KNEE_ANGLES]
    def cost(y, z):
        cs = contact(y, z); return sum((c - cs[0]) ** 2 for c in cs[1:])
    best = min(((cost(y, z), y, z) for y in _np.arange(head.y - 0.04, head.y + 0.0401, 0.005)
                for z in _np.arange(head.z - 0.09, head.z + 0.0301, 0.005)))
    _, y0, z0 = best
    best = min([best] + [(cost(y, z), y, z) for y in _np.arange(y0 - 0.004, y0 + 0.00401, 0.001)
                         for z in _np.arange(z0 - 0.004, z0 + 0.00401, 0.001)])
    _, y, z = best
    return (float(y), float(z)), dict(
        angles_deg=list(range(0, 151, 15)),
        plateau_to_femur_mm_old_hinge=[round(c * 1e3, 1) for c in contact(head.y, head.z)],
        plateau_to_femur_mm_new_hinge=[round(c * 1e3, 1) for c in contact(y, z)],
        patella_to_femur_mm_rigid_on_tibia=[round(c * 1e3, 1) for c in contact(y, z, P)])

knee = {}
for side, S in (('r', 'Right'), ('l', 'Left')):
    h = arm.data.bones[S + 'Leg'].head_local.copy()
    (y, z), ev = knee_pivot(side, h)
    knee[S + 'Leg'] = dict(old_head=[round(c, 5) for c in h], new_head=[round(h.x, 5), round(y, 5), round(z, 5)], **ev)
    log('knee hinge', S + 'Leg', 'moved', [round(c, 4) for c in h], '->', knee[S + 'Leg']['new_head'],
        'plateau gap mm old', ev['plateau_to_femur_mm_old_hinge'], 'new', ev['plateau_to_femur_mm_new_hinge'])

# REST snapshot (armature space) AFTER the helpers are gone but BEFORE any edit
rest0 = {b.name: dict(head=tuple(b.head_local), tail=tuple(b.tail_local),
                      M=[list(r) for r in b.matrix_local]) for b in arm.data.bones}

# ---------------------------------------------------------------- 4. flatten
SPINE = ['L5', 'L4', 'L3', 'L2', 'L1'] + ['T%d' % i for i in range(12, 0, -1)] + ['C%d' % i for i in range(7, 0, -1)]
NEW_PARENT = {'L5': 'Hips'}
for lo, hi in zip(SPINE, SPINE[1:]):
    NEW_PARENT[hi] = lo
NEW_PARENT['Head'] = 'C1'
# the patella rides with the shank (the patellar ligament does not stretch); the source turned it by half the knee
# angle through a driver, which glTF can't carry. Measured lift-off from the femur is in rig-report.json (knee).
NEW_PARENT['Patella.l.001'] = 'RightLeg'     # bone Patella.l.001 is the RIGHT patella (source naming quirk)
NEW_PARENT['Patella.l'] = 'LeftLeg'
for side, S in (('r', 'Right'), ('l', 'Left')):
    NEW_PARENT['Radius.' + side] = S + 'ForeArm'       # elbow flexion carries both forearm bones
    NEW_PARENT['Ulna.' + side] = S + 'ForeArm'
    NEW_PARENT['Proximal carpal bones-Flexion.' + side] = S + 'Hand'   # wrist bone carries the carpals
    NEW_PARENT['Tibia.' + side] = S + 'Leg'            # knee bone carries tibia + fibula

DELETE = {'LowerBack', 'Spine', 'Spine1', 'Neck-Start', 'Neck1', 'Breath',
          'RightShoulder', 'LeftShoulder'}
for side in 'rl':
    DELETE |= {'Offset.' + side, 'Knee.' + side, 'Knee-Flexion.' + side}
    for i in range(1, 13):
        DELETE |= {'Rib%d-End.%s' % (i, side), 'Cartilage%d-Start.%s' % (i, side)}
DELETE = {n for n in DELETE if n in arm.data.bones}

# a bone that carries a mesh must never be deleted
carrying = {o.parent_bone for o in bpy.data.objects if o.parent == arm and o.parent_type == 'BONE'}
assert not (DELETE & carrying), DELETE & carrying

bpy.context.view_layer.objects.active = arm
for o in bpy.context.selected_objects:
    o.select_set(False)
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
for b in eb:
    b.use_connect = False          # so re-parenting never snaps a head
for child, parent in NEW_PARENT.items():
    eb[child].parent = eb[parent]
for bn, k in knee.items():         # move the hinge, keep the tail (roll re-aligned so local X stays the hinge axis)
    x_axis = eb[bn].x_axis.copy()
    eb[bn].head = _V(k['new_head'])
    eb[bn].align_roll(x_axis.cross(eb[bn].vector).normalized())   # align_roll sets local Z; Z = X x Y keeps X
    k['x_axis_before'] = [round(c, 5) for c in x_axis]; k['x_axis_after'] = [round(c, 5) for c in eb[bn].x_axis]
for n in DELETE:                   # never let a delete silently re-home a child we did not plan for
    for c in eb[n].children:
        if c.name not in DELETE:
            raise RuntimeError('deleting %s would orphan %s' % (n, c.name))
todo = set(DELETE)
while todo:                        # leaves first
    for n in sorted(todo):
        if not eb[n].children:
            eb.remove(eb[n]); todo.discard(n)
n_inherit = 0
for b in eb:
    b.use_deform = True            # every kept bone is a joint the browser can pose
    # glTF / three.js always inherit the parent's full transform. The source rig switches inheritance off
    # on some vertebrae (T12, T3-T1, C6, C2, C1, thyroid) and local location on the metatarsals, which
    # made Blender pose the chain differently from the browser. Make Blender behave like three.js.
    if not b.use_inherit_rotation or b.inherit_scale != 'FULL' or not b.use_local_location or b.use_relative_parent:
        n_inherit += 1
    b.use_inherit_rotation = True; b.inherit_scale = 'FULL'; b.use_local_location = True; b.use_relative_parent = False
log('bones switched to full inheritance (as in glTF)', n_inherit)
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- 5. checks
max_head = max_tail = max_M = 0.0
worst = None
for b in arm.data.bones:
    r = rest0[b.name]
    if b.name in knee:             # hinge moved on purpose: only its tail must stay
        assert (b.tail_local - Matrix.Translation(r['tail']).to_translation()).length < 1e-6, b.name
        continue
    dh = (b.head_local - Matrix.Translation(r['head']).to_translation()).length
    dt = (b.tail_local - Matrix.Translation(r['tail']).to_translation()).length
    dM = max(abs(b.matrix_local[i][j] - r['M'][i][j]) for i in range(4) for j in range(4))
    if max(dh, dt) > max(max_head, max_tail):
        worst = b.name
    max_head = max(max_head, dh); max_tail = max(max_tail, dt); max_M = max(max_M, dM)
log('REST deviation max head %.6f mm, tail %.6f mm, matrix %.2e (worst %s)' % (max_head * 1e3, max_tail * 1e3, max_M, worst))

# identity pose must equal REST now that there are no constraints
arm.data.pose_position = 'POSE'
for pb in arm.pose.bones:
    pb.rotation_mode = 'QUATERNION'
    pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()
max_pose = max(max(abs(pb.matrix[i][j] - pb.bone.matrix_local[i][j]) for i in range(4) for j in range(4))
               for pb in arm.pose.bones)
log('identity pose vs REST max matrix diff %.2e' % max_pose)

# rigid bone meshes of the rig file must sit where they did at REST (they follow the bones)
dg = bpy.context.evaluated_depsgraph_get()

roots = [b.name for b in arm.data.bones if b.parent is None]
log('roots', roots)
chain = []
b = arm.data.bones['Head']
while b:
    chain.append(b.name); b = b.parent
log('Head->root chain', ' <- '.join(chain))

report = dict(
    bones_before=len(rest0), bones_after=len(arm.data.bones), deleted=sorted(DELETE),
    reparented=NEW_PARENT, drivers_deleted=n_drv, constraints_deleted=n_con,
    limits_local_deg={k: v for k, v in limits.items() if k in arm.data.bones},
    knee=knee,
    rest_max_head_mm=max_head * 1e3, rest_max_tail_mm=max_tail * 1e3, rest_max_matrix=max_M,
    identity_pose_vs_rest=max_pose, roots=roots, head_chain=chain,
    rig_bone_meshes={o.name: o.parent_bone for o in bpy.data.objects if o.parent == arm and o.parent_type == 'BONE'},
)
json.dump(report, open(os.path.join(OUT, 'rig-report.json'), 'w'), indent=1)
assert max_head < 1e-5 and max_tail < 1e-5, 'REST moved'
assert max_pose < 1e-4, 'identity pose != REST'

bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backups in out/
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, 'rig.blend')), compress=False)
log('saved', len(arm.data.bones), 'bones')
