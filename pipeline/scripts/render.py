"""Step 6: prove the flattened rig poses. Renders from behind, REST and a test pose, using joint-map.json.

Run:  Blender -b <out>/assembled.blend --python pipeline/scripts/render.py -- <out_dir>

Test pose (the across-body reach, exaggerated so it reads in a still):
  upperBack flexion 24 + rotation -24 (front turns to the subject's left), spread evenly over T12..T1
  shoulderGirdle.r protraction 20, scapula.r upwardRotation 10
  shoulder.r flexion 90 + horizontalAdduction 40, elbow.r flexion 10
Every angle goes through joint-map.json (bone + REST-local axis), the same way src/core/ will.
Writes render_{rest,pose}_back.png, render_{rest,pose}_back_deep.png (trapezius + latissimus hidden),
render_pose_front.png and render.json (bone/mesh
positions that prove things moved, plus how far each muscle's vertices travelled).
"""
import bpy, sys, os, json, math
import numpy as np
from mathutils import Vector, Quaternion

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'pipeline/out'
jm = json.load(open(os.path.join(OUT, 'joint-map.json')))
arm = bpy.data.objects['Armature']
arm.data.pose_position = 'POSE'
scene = bpy.context.scene

def log(*a):
    print('RND', *a, flush=True)

TRUNK = ['T%d' % i for i in range(12, 0, -1)]
POSE = {
    'upperBack': {'flexion': 24, 'rotation': -24},
    'shoulderGirdle.r': {'protraction': 20},
    'scapula.r': {'upwardRotation': 10},
    'shoulder.r': {'flexion': 90, 'horizontalAdduction': 40},
    'elbow.r': {'flexion': 10},
}
ORDER = ['horizontalAdduction', 'flexion', 'abduction', 'rotation', 'sideBend', 'protraction', 'elevation',
         'upwardRotation', 'posteriorTilt', 'internalRotation', 'pronation', 'tilt', 'turn']

def apply_pose(pose):
    per_bone = {}
    for joint, moves in pose.items():
        for mv, deg in moves.items():
            if joint == 'upperBack':      # spread evenly over the thoracic chain (src/core/ decides the real shares)
                for b in TRUNK:
                    m = jm['joints']['vertebra.' + b]['movements'][mv]
                    per_bone.setdefault(m['bone'], []).append((mv, m['axis_local'], deg / len(TRUNK)))
            else:
                m = jm['joints'][joint]['movements'][mv]
                per_bone.setdefault(m['bone'], []).append((mv, m['axis_local'], deg))
    for pb in arm.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0)
    for bone, lst in per_bone.items():
        q = Quaternion()
        for mv, ax, deg in sorted(lst, key=lambda t: ORDER.index(t[0])):
            q = q @ Quaternion(Vector(ax), math.radians(deg))
        arm.pose.bones[bone].rotation_quaternion = q
    bpy.context.view_layer.update()

def world_verts(o):
    dg = bpy.context.evaluated_depsgraph_get()
    oe = o.evaluated_get(dg); me = oe.to_mesh()
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co)
    oe.to_mesh_clear()
    mw = np.array(oe.matrix_world)
    return co.reshape(-1, 3) @ mw[:3, :3].T + mw[:3, 3]

# ---------------------------------------------------------------- look
meshes = [o for o in bpy.data.objects if o.type == 'MESH' and o.get('za_layer')]
for o in bpy.data.objects:
    o.hide_render = o not in meshes and o.type != 'CAMERA'
HIGHLIGHT = ('Rhomboid',)
for o in meshes:
    n = o['za_name']
    if o['za_layer'] == 'skeleton':
        o.color = (0.93, 0.91, 0.86, 1)
    elif any(h in n for h in HIGHLIGHT):
        o.color = (0.27, 0.40, 0.61, 1)          # b28 steel blue for the golden-case muscle
    elif 'intercostal' in n:
        o.color = (0.62, 0.36, 0.33, 1)
    else:
        o.color = (0.76, 0.34, 0.30, 1)
scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading
sh.light = 'STUDIO'; sh.color_type = 'OBJECT'; sh.show_cavity = True
scene.render.resolution_x = 900; scene.render.resolution_y = 1100
scene.render.film_transparent = False
scene.world = scene.world or bpy.data.worlds.new('W')
cam_data = bpy.data.cameras.new('Cam'); cam_data.type = 'ORTHO'; cam_data.ortho_scale = 0.95
cam = bpy.data.objects.new('Cam', cam_data); scene.collection.objects.link(cam); scene.camera = cam
TGT = Vector((-0.05, 0.0, 1.18))

COVER = ('trapezius', 'Latissimus')      # hidden in the 'deep' views so the rhomboids and blade show

def shoot(name, view):
    deep = view.endswith('deep')
    for o in meshes:
        o.hide_render = deep and any(c in o['za_name'] for c in COVER)
    if view.startswith('back'): # behind the subject: anterior is -Y, so the camera sits at +Y looking toward -Y
        cam.location = TGT + Vector((0, 2.0, 0))
    elif view == 'front':       # in front, right, above: shows the arm across the body
        cam.location = TGT + Vector((-1.2, -1.6, 0.6))
    else:                       # behind, right, above
        cam.location = TGT + Vector((-1.3, 1.4, 0.7))
    cam.rotation_euler = (TGT - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = os.path.abspath(os.path.join(OUT, 'render_%s_%s.png' % (name, view)))
    bpy.ops.render.render(write_still=True)
    log('wrote', scene.render.filepath)

# ---------------------------------------------------------------- REST
apply_pose({})
rest = {o['za_name']: world_verts(o) for o in meshes}
P = arm.pose.bones
probe = lambda: {b: [round(c, 3) for c in P[b].tail] for b in ('RightArm', 'Radius.r', 'Scapula.r', 'T1', 'Clavicle-X.r')}
rest_probe = probe()
shoot('rest', 'back')
shoot('rest', 'back_deep')

# ---------------------------------------------------------------- test pose
apply_pose(POSE)
posed_probe = probe()
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bands as BANDS
helper_err = BANDS.verify_runtime(arm)       # browser math vs Blender's STRETCH_TO, per helper
# fixture for src/core/jointmap.test.ts: the same helpers in this pose, Blender armature space
fx = []
for pb in P:
    cs = [c for c in pb.constraints if c.type == 'STRETCH_TO' and pb.name.startswith('MH_')]
    if not cs: continue
    par, tgt = pb.parent, P[cs[0].subtarget]
    loc = par.bone.matrix_local.inverted() @ pb.bone.matrix_local
    pw = par.matrix
    q = lambda m: [round(c, 7) for c in (m.to_quaternion().x, m.to_quaternion().y, m.to_quaternion().z, m.to_quaternion().w)]
    fx.append(dict(bone=pb.name, parent_position=[round(c, 7) for c in pw.translation], parent_quaternion=q(pw),
                   rest_local_position=[round(c, 7) for c in loc.translation], rest_local_quaternion=q(loc),
                   target=[round(c, 7) for c in tgt.head], rest_length=round(cs[0].rest_length, 7),
                   expected_matrix3=[[round(pb.matrix[i][j], 7) for j in range(3)] for i in range(3)]))
json.dump(dict(_about='Written by pipeline/scripts/render.py: bands helpers in the render test pose, Blender armature space '
               '(stretch axis local +Y, volume axis local +Z). expected_matrix3 = Blender pose-bone matrix (rotation x scale).',
               helpers=fx), open(os.path.join(OUT, 'helpers-fixture.json'), 'w'), indent=1)
log('helper runtime max err', max(helper_err.values()) if helper_err else None, 'over', len(helper_err), 'helpers')
moved = {}
for o in meshes:
    d = np.linalg.norm(world_verts(o) - rest[o['za_name']], axis=1) * 1e3
    moved[o['za_name']] = dict(mean_mm=round(float(d.mean()), 1), max_mm=round(float(d.max()), 1))
shoot('pose', 'back')
shoot('pose', 'back_deep')
shoot('pose', 'front')
json.dump(dict(pose=POSE, helper_runtime_err=helper_err, bone_tails_rest=rest_probe, bone_tails_pose=posed_probe, vertex_travel=moved),
          open(os.path.join(OUT, 'render.json'), 'w'), indent=1)
log('RightArm tail rest', rest_probe['RightArm'], 'pose', posed_probe['RightArm'])
log('travel', {k: v['mean_mm'] for k, v in moved.items() if 'Rhomboid' in k or k in ('Scapula.r', 'Vertebra T1', 'Humerus.r', 'Sacrum')})
