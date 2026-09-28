"""Step 3: bring the baked full-file structures onto the flattened rig, decimate, and weight them.

Run:  Blender -b <out>/rig.blend --python pipeline/scripts/assemble.py -- <out_dir>

- Pairs each full-file bone mesh with its rig bone: rig-file bone mesh -> bone (from the rig), rig-file
  mesh name -> full-file mesh name (data/bone_mesh_match.json + data/bone-fixups.json). Every pairing is
  checked by centroid distance before the rig-file meshes are thrown away.
- Skeleton: decimated, then rigidly skinned (one vertex group = its bone, weight 1).
- Muscles: decimated, then weighted with "c2" at REST: inverse distance to the nearest bone-mesh
  *surface* (BVH), power 4, 5 Laplacian smoothing passes, top 4 influences, renormalized.
  Weighting targets are the full-file bone meshes of every rig bone (not only the exported subset), at
  full resolution, so a muscle that reaches the skull or arm still gets sensible bones.
- Muscles in bands.SPEC (rhomboid major/minor, levator scapulae) use "bands" instead of c2: fanned
  helper bones MH_<muscle>_<k> (STRETCH_TO a target MT_<muscle>_<k> on the scapula) carry the belly, the
  ends stay pinned to the vertebrae and the scapula. See bands.py for the method and its numbers.
- Writes <out>/assembled.blend and <out>/assemble.json (pairing gaps, tri counts, weight checks).
"""
import bpy, sys, json, os, time, math
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bands as BANDS
from mathutils import Vector
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'pipeline/out'
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')

IDW_POWER, IDW_EPS, SMOOTH_ITERS, SMOOTH_ALPHA, MAX_INF, BBOX_MARGIN = 4, 0.002, 5, 0.5, 4, 0.08
TRI_FLOOR = 48

def log(*a):
    print('ASM', *a, flush=True)

S = json.load(open(os.path.join(DATA, 'structures.json')))
match = json.load(open(os.path.join(DATA, 'bone_mesh_match.json')))
fix = {k: v for k, v in json.load(open(os.path.join(DATA, 'bone-fixups.json'))).items() if not k.startswith('_')}
bio2full = {m['bio']: m['full'] for m in match if m['full']}
bio2full.update(fix)

arm = bpy.data.objects['Armature']
arm.data.pose_position = 'REST'
scene = bpy.context.scene

def world_co(o):
    me = o.data
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    mw = np.array(o.matrix_world)
    return co @ mw[:3, :3].T + mw[:3, 3]

# ------------------------------------------------ rig-file bone meshes -> bone, and their REST geometry
dg = bpy.context.evaluated_depsgraph_get()
bio = {}
for o in bpy.data.objects:
    if o.parent == arm and o.parent_type == 'BONE' and o.type == 'MESH':
        oe = o.evaluated_get(dg); me = oe.to_mesh()
        co = np.array([tuple(oe.matrix_world @ v.co) for v in me.vertices])
        oe.to_mesh_clear()
        bio[o.name] = (o.parent_bone, co)
log('rig-file bone meshes', len(bio))

# ------------------------------------------------ append the baked structures
path = os.path.abspath(os.path.join(OUT, 'select.blend'))
with bpy.data.libraries.load(path, link=False) as (src, dst):
    dst.objects = list(src.objects)
col = bpy.data.collections.new('Anatomy'); scene.collection.children.link(col)
new = {}
stray = []
for o in dst.objects:
    if o is None: continue
    if 'za_name' not in o:
        stray.append(o.name); bpy.data.objects.remove(o, do_unlink=True); continue
    col.objects.link(o); new[o['za_name']] = o
if stray: log('dropped stray appended objects', len(stray), stray[:5])
log('appended', len(new))

# ------------------------------------------------ pair full meshes with bones, verify
full2bone, pair_rows = {}, []
for bname, (bone, co) in bio.items():
    fname = bio2full.get(bname)
    if not fname or fname not in new:
        pair_rows.append(dict(rig_mesh=bname, bone=bone, full=None)); continue
    fco = world_co(new[fname])
    dc = float(np.linalg.norm(co.mean(0) - fco.mean(0)))
    dbb = float(np.abs(np.r_[co.min(0) - fco.min(0), co.max(0) - fco.max(0)]).max())
    full2bone[fname] = bone
    pair_rows.append(dict(rig_mesh=bname, bone=bone, full=fname, centroid_gap_mm=round(dc * 1e3, 3), bbox_gap_mm=round(dbb * 1e3, 3)))
unpaired_rig = [r['rig_mesh'] for r in pair_rows if r['full'] is None]
worst = sorted((r for r in pair_rows if r['full']), key=lambda r: -r['centroid_gap_mm'])[:8]
log('paired', len(full2bone), 'unpaired rig meshes', unpaired_rig)
log('worst centroid gaps', [(r['full'], r['centroid_gap_mm']) for r in worst])
assert all(r['centroid_gap_mm'] < 15 for r in pair_rows if r['full']), 'a pairing is >15 mm off'
for n in S['skeleton']['names']:
    assert n in full2bone, 'no bone for skeleton structure %s' % n

# ------------------------------------------------ drop everything that is not ours
keep = set(new.values()) | {arm}
for o in list(bpy.data.objects):
    if o not in keep:
        bpy.data.objects.remove(o, do_unlink=True)
for coll in list(bpy.data.collections):
    if coll is not col and not coll.objects and not coll.children:
        bpy.data.collections.remove(coll)
bpy.ops.outliner.orphans_purge(do_recursive=True)
log('objects left', len(bpy.data.objects))

# ------------------------------------------------ weighting targets: one BVH per bone (full-res meshes)
bone_verts, bone_tris = {}, {}
for fname, bone in full2bone.items():
    o = new[fname]
    co = world_co(o)
    o.data.calc_loop_triangles()
    tri = np.empty(len(o.data.loop_triangles) * 3, dtype=np.int64)
    o.data.loop_triangles.foreach_get('vertices', tri)
    tri = tri.reshape(-1, 3)
    off = len(bone_verts.get(bone, []))
    bone_verts[bone] = np.vstack([bone_verts[bone], co]) if bone in bone_verts else co
    bone_tris[bone] = np.vstack([bone_tris[bone], tri + off]) if bone in bone_tris else tri
bvh, bbox = {}, {}
for b in bone_verts:
    bvh[b] = BVHTree.FromPolygons([tuple(v) for v in bone_verts[b]], [tuple(t) for t in bone_tris[b]])
    bbox[b] = (bone_verts[b].min(0), bone_verts[b].max(0))
log('weight target bones', len(bvh))

# ------------------------------------------------ palette materials
PAL = {'bone': (0.89, 0.86, 0.79, 1), 'cartilage': (0.72, 0.80, 0.84, 1),
       'muscle': (0.72, 0.30, 0.27, 1), 'tendon': (0.93, 0.88, 0.76, 1)}
mats = {}
for k, c in PAL.items():
    m = bpy.data.materials.new(k)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = c
    p.inputs['Roughness'].default_value = 0.7
    m.diffuse_color = c
    mats[k] = m

def repaint(o, layer):
    me = o.data
    kinds = []
    for m in me.materials:
        n = (m.name if m else '').lower()
        if layer == 'skeleton':
            kinds.append('cartilage' if 'cartilage' in n or o['za_name'].startswith('Costal cartilage') else 'bone')
        else:
            kinds.append('tendon' if 'tendon' in n else 'muscle')
    if not kinds:
        kinds = ['bone' if layer == 'skeleton' else 'muscle']
    order = sorted(set(kinds), key=list(PAL).index)
    idx = np.empty(len(me.polygons), dtype=np.int32); me.polygons.foreach_get('material_index', idx)
    remap = np.array([order.index(k) for k in kinds] or [0], dtype=np.int32)
    idx = remap[np.clip(idx, 0, len(remap) - 1)]
    me.materials.clear()
    for k in order:
        me.materials.append(mats[k])
    me.polygons.foreach_set('material_index', idx)

# ------------------------------------------------ decimate
def ratio_for(name, layer):
    cfg = S[layer]
    r = cfg['ratio_default']
    if name in cfg['ratio']:
        return cfg['ratio'][name]
    for k, v in cfg['ratio'].items():
        if k.lower() in name.lower():
            r = v
    return r

def tris(o):
    o.data.calc_loop_triangles(); return len(o.data.loop_triangles)

def decimate(o, ratio):
    t0 = tris(o)
    ratio = min(1.0, max(ratio, TRI_FLOOR / max(t0, 1)))
    if ratio < 1.0:
        m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = ratio; m.use_collapse_triangulate = True
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier='dec')
    if o.data.validate(verbose=False):     # collapse can leave degenerate faces; the glTF exporter warns on them
        log('validate fixed geometry on', o.name)
    return t0, tris(o), ratio

# ------------------------------------------------ weighting
def adjacency(me):
    e = np.empty(len(me.edges) * 2, dtype=np.int64); me.edges.foreach_get('vertices', e)
    return e.reshape(-1, 2)

def smooth(W, E, n, iters, alpha):
    deg = np.zeros(n); np.add.at(deg, E[:, 0], 1); np.add.at(deg, E[:, 1], 1); deg = np.maximum(deg, 1)
    for _ in range(iters):
        acc = np.zeros_like(W)
        np.add.at(acc, E[:, 0], W[E[:, 1]]); np.add.at(acc, E[:, 1], W[E[:, 0]])
        W = (1 - alpha) * W + alpha * acc / deg[:, None]
    return W

def c2_weights(o):
    V = world_co(o)
    lo, hi = V.min(0) - BBOX_MARGIN, V.max(0) + BBOX_MARGIN
    excl = set()
    for k, v in S['muscles'].get('weight_exclude', {}).items():
        if not k.startswith('_') and k.lower() in o['za_name'].lower():
            excl |= set(v)
    cands = [b for b, (blo, bhi) in bbox.items() if np.all(bhi >= lo) and np.all(blo <= hi) and b not in excl]
    D = np.empty((len(V), len(cands)))
    for j, b in enumerate(cands):
        t = bvh[b]
        D[:, j] = [t.find_nearest(Vector(p))[3] for p in V]
    W = 1.0 / (D + IDW_EPS) ** IDW_POWER
    W /= W.sum(1, keepdims=True)
    W = smooth(W, adjacency(o.data), len(V), SMOOTH_ITERS, SMOOTH_ALPHA)
    W /= W.sum(1, keepdims=True)
    idx = np.argsort(-W, axis=1)[:, :MAX_INF]
    top = np.take_along_axis(W, idx, 1)
    top[top < 1e-4] = 0
    top /= np.maximum(top.sum(1, keepdims=True), 1e-12)
    return cands, idx, top, D.min(1)

def write_groups(o, bones, idx, top):
    for vg in list(o.vertex_groups):
        o.vertex_groups.remove(vg)
    groups = {}
    for j in np.unique(idx[top > 0]):
        groups[j] = o.vertex_groups.new(name=bones[j])
    for j, g in groups.items():
        rows, cols = np.nonzero((idx == j) & (top > 0))
        for r, c in zip(rows.tolist(), cols.tolist()):
            g.add([r], float(top[r, c]), 'REPLACE')

def bind(o):
    m = o.modifiers.new('Armature', 'ARMATURE'); m.object = arm
    o.parent = arm; o.matrix_parent_inverse = arm.matrix_world.inverted()

def check_groups(o):
    n = len(o.data.vertices)
    cnt = np.zeros(n, int); tot = np.zeros(n)
    for v in o.data.vertices:
        ws = [g.weight for g in v.groups if g.weight > 0]
        cnt[v.index] = len(ws); tot[v.index] = sum(ws)
    return dict(zero_weight=int((tot < 1e-6).sum()), max_influences=int(cnt.max()),
                sum_err=float(np.abs(tot - 1).max()))

report = dict(pairs=pair_rows, structures={})
t_all = time.time()
for name in S['skeleton']['names']:
    o = new[name]
    t0, t1, r = decimate(o, ratio_for(name, 'skeleton'))
    repaint(o, 'skeleton')
    bone = full2bone[name]
    g = o.vertex_groups.new(name=bone)
    g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    bind(o)
    chk = check_groups(o)
    o['za_bone'] = bone
    report['structures'][name] = dict(layer='skeleton', bone=bone, tris_src=t0, tris=t1, ratio=round(r, 4), **chk)
log('skeleton done', sum(v['tris'] for v in report['structures'].values()), 'tris')

surfaces = None
helpers = {}
for name in S['muscles']['names']:
    o = new[name]
    t0, t1, r = decimate(o, ratio_for(name, 'muscles'))
    repaint(o, 'muscles')
    ts = time.time()
    method = 'bands' if name.rsplit('.', 1)[0] in BANDS.SPEC else 'c2'
    if method == 'bands':
        if surfaces is None:
            surfaces = BANDS.BoneSurfaces.from_arrays(bone_verts, bone_tris)
        res = BANDS.weight_muscle(o, arm, surfaces, method='bands')
        o.parent = arm; o.matrix_parent_inverse = arm.matrix_world.inverted()
        hb = [b for b in res['bones'] if b.startswith('MH_')]
        helpers[name] = dict(helpers=hb, note=res['note'])
        # dense view for the report below
        vgs = [vg.name for vg in o.vertex_groups]
        bones = vgs
        W = np.zeros((len(o.data.vertices), len(vgs)))
        for v in o.data.vertices:
            for g in v.groups: W[v.index, g.group] = g.weight
        idx = np.argsort(-W, axis=1)[:, :MAX_INF]; top = np.take_along_axis(W, idx, 1)
        V = world_co(o)
        dmin = np.min(np.stack([np.array([bvh[b].find_nearest(Vector(p))[3] for p in V]) for b in res['bones'] if b in bvh], 1), 1)
        log('bands', name, res['note'])
    else:
        bones, idx, top, dmin = c2_weights(o)
        write_groups(o, bones, idx, top)
        bind(o)
    chk = check_groups(o)
    used = sorted({bones[j] for j in np.unique(idx[top > 0])})
    main = {}
    for j, w in zip(idx.ravel(), top.ravel()):
        if w > 0: main[bones[j]] = main.get(bones[j], 0) + float(w)
    main = sorted(main.items(), key=lambda kv: -kv[1])[:5]
    report['structures'][name] = dict(layer='muscles', method=method, tris_src=t0, tris=t1, ratio=round(r, 4), verts=len(o.data.vertices),
                                      weight_s=round(time.time() - ts, 2), candidates=len(bones), bones_used=len(used),
                                      top_bones=[(b, round(w / len(o.data.vertices), 3)) for b, w in main],
                                      touching_bone_pct=round(float((dmin < 0.003).mean() * 100), 1), **chk)
    log('muscle', name, json.dumps(report['structures'][name]))
    assert chk['zero_weight'] == 0 and chk['max_influences'] <= MAX_INF and chk['sum_err'] < 1e-3, name

for o in list(new.values()):
    if o['za_layer'] == 'ref':
        bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.outliner.orphans_purge(do_recursive=True)
report['helpers'] = helpers
report['totals'] = {l: dict(structures=sum(1 for v in report['structures'].values() if v['layer'] == l),
                            tris=sum(v['tris'] for v in report['structures'].values() if v['layer'] == l),
                            tris_src=sum(v['tris_src'] for v in report['structures'].values() if v['layer'] == l))
                    for l in ('skeleton', 'muscles')}
log('totals', report['totals'], 'time %.1fs' % (time.time() - t_all))
json.dump(report, open(os.path.join(OUT, 'assemble.json'), 'w'), indent=1)
bpy.context.preferences.filepaths.save_version = 0   # no .blend1 backups in out/
bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(os.path.join(OUT, 'assembled.blend')), compress=False)
log('saved assembled.blend')
