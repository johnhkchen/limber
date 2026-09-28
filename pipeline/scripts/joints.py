"""Step 4: measure what each joint's axes mean and write joint-map.json.

Run:  Blender -b <out>/assembled.blend --python pipeline/scripts/joints.py -- <out_dir>

Exercise JSON speaks in plain movements ("shoulder.r flexion 90"). This script turns each movement into
(bone, unit axis in the bone's REST-local frame, sign) and *measures* it: it poses the bone +10 degrees
about that axis in Blender and checks that a probe point moves the way the movement's name says
(e.g. shoulder flexion: the elbow moves forward). Nothing here is assumed from bone names.

Coordinates: Blender/Z-Anatomy is metres, Z up, anterior = -Y, subject's left = +X.
glTF/three.js (after the exporter's Y-up conversion): (x, y, z)_three = (x, z, -y)_blender, so anterior = +Z,
up = +Y, subject's left = +X. The exporter converts
world space only: a bone's world rotation in three is C.R_blender, so its bone-local frame is unchanged and a
bone-local axis a (Blender) is the same a in three's bone-local frame (axis_three == axis_local). check.mjs
verifies the frames and poses through axis_three.
"""
import bpy, sys, json, os, math, re
from mathutils import Matrix, Vector, Quaternion

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'pipeline/out'
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')

def log(*a):
    print('JNT', *a, flush=True)

arm = bpy.data.objects['Armature']
A = arm.data
P = arm.pose.bones
A.pose_position = 'POSE'
rig_report = json.load(open(os.path.join(OUT, 'rig-report.json')))
limits = rig_report.get('limits_local_deg', {})

X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
ANT, POST, UP, DOWN = Vector((0, -1, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((0, 0, -1))

def reset():
    for pb in P:
        pb.rotation_mode = 'QUATERNION'
        pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()

def lateral(bone):
    return Vector((1 if A.bones[bone].head_local.x > 0 else -1, 0, 0))

def pose_point(bone, p_rest):
    """where a point rigidly attached to `bone` goes in the current pose"""
    pb = P[bone]
    return (pb.matrix @ pb.bone.matrix_local.inverted()) @ p_rest

def rest_rot(bone):
    return A.bones[bone].matrix_local.to_3x3()

def principal(v):
    names = ['X', 'Y', 'Z']
    i = max(range(3), key=lambda k: abs(v[k]))
    s = '+' if v[i] > 0 else '-'
    dev = math.degrees(math.acos(min(1.0, abs(v[i]) / v.length)))
    return s + names[i], round(dev, 1)

def measure(bone, world_axis, probe_rest, want_dir, pre=None, local_axis=None, deg=10.0):
    """axis = world_axis expressed in the bone's rest frame (or an explicit local axis).
    Pose +deg, see if probe moves along want_dir; flip if not. Returns the signed local axis + evidence."""
    a = (local_axis if local_axis is not None else rest_rot(bone).inverted() @ world_axis).normalized()
    for attempt in (0, 1):
        reset()
        q_pre = pre() if pre else Quaternion()
        P[bone].rotation_quaternion = q_pre
        bpy.context.view_layer.update()
        p0 = pose_point(bone, probe_rest)
        P[bone].rotation_quaternion = Quaternion(a, math.radians(deg)) @ q_pre
        bpy.context.view_layer.update()
        p1 = pose_point(bone, probe_rest)
        d = p1 - p0
        along = d.dot(want_dir.normalized())
        if along > 0:
            break
        a = -a
    reset()
    nm, dev = principal(a)
    return dict(bone=bone, axis_local=[round(c, 5) for c in a], axis_three=[round(a.x, 5), round(a.y, 5), round(a.z, 5)],
                nearest_local_axis=nm, off_axis_deg=dev,
                check=dict(deg=deg, probe_moved_mm=[round(c * 1e3, 2) for c in d], along_expected_mm=round(along * 1e3, 2),
                           ok=bool(along > 0)))

def H(b): return A.bones[b].head_local.copy()
def T(b): return A.bones[b].tail_local.copy()

J = {}
def axial(key, bone, extra=None):
    h = H(bone)
    mv = {
        'flexion': measure(bone, X, h + UP * 0.1, ANT),                  # + = bend forward
        'sideBend': measure(bone, Y, h + UP * 0.1, Vector((-1, 0, 0))),  # + = bend to the subject's right
        'rotation': measure(bone, Z, h + ANT * 0.1, Vector((-1, 0, 0))), # + = front turns to the subject's right
    }
    J[key] = dict(bone=bone, movements=mv)

# trunk: every vertebra gets its own axes; src/core spreads lowBack over L5-L1, upperBack over T12-T1, neck over C7-C1
for b in ['L5', 'L4', 'L3', 'L2', 'L1'] + ['T%d' % i for i in range(12, 0, -1)] + ['C%d' % i for i in range(7, 0, -1)]:
    axial('vertebra.' + b, b)
axial('head', 'Head')
h = H('Hips')
J['pelvis'] = dict(bone='Hips', movements={
    'tilt': measure('Hips', X, h + UP * 0.1, ANT),                      # + = anterior tilt (top of pelvis forward)
    'sideBend': measure('Hips', Y, h + UP * 0.1, Vector((-1, 0, 0))),
    'turn': measure('Hips', Z, h + ANT * 0.1, Vector((-1, 0, 0))),
}, position_units='metres (Blender world)')

for s, S in (('r', 'Right'), ('l', 'Left')):
    lat = lateral('Scapula.' + s)
    med = -lat
    # shoulder girdle: clavicle lateral end
    J['shoulderGirdle.' + s] = dict(bone='Clavicle-Z.' + s, movements={
        'elevation': measure('Clavicle-Z.' + s, Y, T('Clavicle-X.' + s), UP),
        'protraction': measure('Clavicle-Z.' + s, Z, T('Clavicle-X.' + s), ANT),
    }, note='Clavicle-X.%s (child) is also free; the scapula and arm ride on the clavicle.' % s)
    sc = 'Scapula.' + s
    below = H(sc) + DOWN * 0.15 + med * 0.03       # roughly the inferior angle
    J['scapula.' + s] = dict(bone=sc, movements={
        'upwardRotation': measure(sc, Y, below, lat),                 # inferior angle swings out
        'posteriorTilt': measure(sc, X, below, ANT),                  # inferior angle presses toward the ribs
        'internalRotation': measure(sc, Z, H(sc) + med * 0.08, POST), # medial border lifts off (winging)
    })
    ua = S + 'Arm'
    elbow = T(ua)
    J['shoulder.' + s] = dict(bone=ua, movements={
        'flexion': measure(ua, X, elbow, ANT),
        'abduction': measure(ua, Y, elbow, lat),
        'rotation': measure(ua, None, elbow + ANT * 0.1, lat, local_axis=Vector((0, 1, 0))),   # + = external
    })
    # horizontal adduction is defined from 90 deg flexion: rotate about the rest-frame vertical, elbow moves medially
    flex = J['shoulder.' + s]['movements']['flexion']
    fa = Vector(flex['axis_local'])
    J['shoulder.' + s]['movements']['horizontalAdduction'] = measure(
        ua, Z, elbow, med, pre=lambda fa=fa: Quaternion(fa, math.radians(90)))
    J['shoulder.' + s]['movements']['horizontalAdduction']['compose'] = 'outermost: q = q_hAdd * q_flexion * q_abduction * q_rotation'
    fa_ = S + 'ForeArm'
    wrist = T('Radius.' + s)
    J['elbow.' + s] = dict(bone=fa_, movements={
        'flexion': measure(fa_, X, wrist, ANT),
        'pronation': measure('Radius.' + s, None, wrist + lat * 0.03, ANT, local_axis=Vector((0, 1, 0))),
    }, note='flexion on %s carries radius + ulna; pronation turns Radius.%s about its own long axis (approximation of the radio-ulnar axis)' % (fa_, s))
    hd = S + 'Hand'
    tip = T(hd) + DOWN * 0.08
    J['wrist.' + s] = dict(bone=hd, movements={
        'flexion': measure(hd, X, tip, ANT),
        'ulnarDeviation': measure(hd, Y, tip, med),
    })
    ul = S + 'UpLeg'
    knee = T(ul)
    J['hip.' + s] = dict(bone=ul, movements={
        'flexion': measure(ul, X, knee, ANT),
        'abduction': measure(ul, Y, knee, lat),
        'rotation': measure(ul, None, knee + ANT * 0.1, lat, local_axis=Vector((0, 1, 0))),   # + = external
    })
    lg = S + 'Leg'
    ankle = H(S + 'Foot')
    J['knee.' + s] = dict(bone=lg, movements={'flexion': measure(lg, X, ankle, POST)})
    ft = S + 'Foot'
    J['ankle.' + s] = dict(bone=ft, movements={'dorsiflexion': measure(ft, X, H(ft) + ANT * 0.12, UP)})

# breath: each RibN-Start turns about an axis that lifts the front of the rib (measured, per side).
# The shares are the rig's own (ribs 1-2 100% ... rib 10 20%); src/core scales them by breath.amount.
BREATH_SHARES = [1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2]
bm = {}
for s in ('r', 'l'):
    for i, share in zip(range(1, 11), BREATH_SHARES):
        b = 'Rib%d-Start.%s' % (i, s)
        m = measure(b, X, T(b), UP)          # + = the front (sternal) end of the rib rises
        m['share'] = share
        bm['rib%d.%s' % (i, s)] = m
J['breath'] = dict(bone='Rib1-Start.r', movements=bm,
                   note='One entry per rib (rib<N>.<side>): axis lifts the rib front; share = the rig\'s breath share. '
                        'src/core turns breath.amount (0..1) into share * amount * breath_max_deg about each axis.')

bad = [(k, m) for k, j in J.items() for m, v in j['movements'].items() if not v['check']['ok']]
assert not bad, bad

# ---------------------------------------------------------------- bones table
def sanitize(n):   # three.js PropertyBinding.sanitizeNodeName: whitespace -> _, strip [ ] . : /
    return re.sub(r'[\[\]\.:/]', '', re.sub(r'\s', '_', n))

meshes = {}
for o in bpy.data.objects:
    if o.type == 'MESH' and o.get('za_layer') == 'skeleton':
        meshes.setdefault(o['za_bone'], []).append(o['za_name'])
bones = {}
for b in A.bones:
    R = b.matrix_local.to_3x3()
    bones[b.name] = dict(
        parent=b.parent.name if b.parent else None,
        head=[round(c, 6) for c in b.head_local], tail=[round(c, 6) for c in b.tail_local],
        length=round(b.length, 6),
        rest_axes=dict(x=[round(c, 5) for c in R.col[0]], y=[round(c, 5) for c in R.col[1]], z=[round(c, 5) for c in R.col[2]]),
        limits_local_deg=limits.get(b.name),
        three_name=sanitize(b.name),
        skeleton_meshes=sorted(meshes.get(b.name, [])),
    )
tn = [v['three_name'] for v in bones.values()]
dupes = sorted({n for n in tn if tn.count(n) > 1})

# pose probe: a compound pose posed here in Blender; check.mjs poses the same through axis_three in three.js
# and compares bone tails, so Blender renders and the browser can never silently disagree.
PROBE_POSE = {'vertebra.T%d' % i: {'flexion': 2.0, 'rotation': -2.0} for i in range(1, 13)}
PROBE_POSE.update({'shoulderGirdle.r': {'protraction': 20}, 'scapula.r': {'upwardRotation': 10},
                   'shoulder.r': {'flexion': 90, 'horizontalAdduction': 40}, 'elbow.r': {'flexion': 10}})
PROBE_ORDER = ['horizontalAdduction', 'flexion', 'abduction', 'rotation', 'sideBend', 'protraction', 'elevation',
               'upwardRotation', 'posteriorTilt', 'internalRotation', 'pronation']
reset()
per = {}
for jn, mvs in PROBE_POSE.items():
    for mv, deg in mvs.items():
        m = J[jn]['movements'][mv]
        per.setdefault(m['bone'], []).append((PROBE_ORDER.index(mv), m['axis_local'], deg))
for b, lst in per.items():
    q = Quaternion()
    for _, ax, deg in sorted(lst):
        q = q @ Quaternion(Vector(ax), math.radians(deg))
    P[b].rotation_quaternion = q
bpy.context.view_layer.update()
probe_tails = {b: [round(c, 6) for c in P[b].tail] for b in ('T1', 'Clavicle-X.r', 'Scapula.r', 'RightArm', 'Radius.r')}
reset()
log('probe tails', probe_tails)

# bands helpers (assemble.py): STRETCH_TO helpers the browser must re-create per frame
helpers = []
for pb in P:
    for c in pb.constraints:
        if c.type == 'STRETCH_TO' and pb.name.startswith('MH_'):
            tb = A.bones[c.subtarget]
            helpers.append(dict(bone=pb.name, parent=pb.parent.name, target=c.subtarget, target_parent=tb.parent.name,
                                rest_length=round(c.rest_length, 6), volume=c.volume, keep_axis=c.keep_axis,
                                stretch_axis_three=[0, 1, 0], volume_axis_three=[0, 0, 1]))
log('helpers', len(helpers))

out = dict(
    _about='Generated by pipeline/scripts/joints.py. Bone names are the Z-Biomechanics rig names, unchanged. '
           'Movement axes are unit vectors in the bone REST-local frame; a positive angle performs the named movement '
           '(measured by posing, see check). Angles are relative to REST = anatomical position.',
    coordinates=dict(
        blender='metres, +Z up, anterior -Y, subject left +X; bone-local Y runs head->tail',
        three='after glTF Y-up export: (x,y,z)_three = (x, z, -y)_blender -> up +Y, anterior (the body faces) +Z, subject left +X',
        axis_three='bone-local axis in three.js == axis_local (the exporter converts world space only, bone-local frames are unchanged); verified by check.mjs'),
    fixups=dict(
        right_patella_bone='Patella.l.001',
        note='Unsuffixed hand/foot phalanx and metacarpal mesh names are right, .001 left; "Third metacarpal bone.l" is right. '
             'In the full file the .l objects are the mirrored (negative-scale) copies.'),
    trunk_chain=rig_report['head_chain'][::-1],
    breath_shares={'Rib%d-Start' % i: s for i, s in zip(range(1, 11), [1.0, 1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2])},
    breath_note='Breath = rotation of each RibN-Start.{l,r} about its bone-local X scaled by the share (from the rig). '
                'Sign/magnitude not yet measured -> open.',
    breath_max_deg=2.0,   # small: the sternum stays put, so bigger rib turns open a gap at the costal cartilages
    pose_probe=dict(pose=PROBE_POSE, order=PROBE_ORDER, tails_blender=probe_tails,
                    note='Posed in Blender by joints.py; check.mjs repeats it in three.js and compares tails.'),
    joints=J,
    helpers=helpers,
    helpers_note='Bands helpers (pipeline/scripts/bands.py). Each frame: carry the helper with its parent, swing its '
                 'stretch axis (bone-local +Y, head to tail, in Blender and three alike) onto the target bone\'s world position, scale that axis by '
                 's = distance / rest_length and the volume axis (bone-local Z) by 1/s. '
                 'The target bones (MT_*) do not deform; they only mark the insertion point on the scapula.',
    bones=bones,
    three_name_collisions=dupes,
)
json.dump(out, open(os.path.join(OUT, 'joint-map.json'), 'w'), indent=1)
log('joints', len(J), 'bones', len(bones), 'three-name collisions', dupes)
for k in ['shoulder.r', 'elbow.r', 'scapula.r', 'shoulderGirdle.r', 'vertebra.T6', 'knee.r', 'wrist.r', 'hip.r']:
    log(k, {m: (v['nearest_local_axis'], v['off_axis_deg']) for m, v in J[k]['movements'].items()})
