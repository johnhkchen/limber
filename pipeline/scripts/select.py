"""Step 2: pick structures from the Z-Anatomy full file and bake them to world space.

Run:  Blender -b pipeline/source/zanatomy/Z-Anatomy/Startup.blend --python pipeline/scripts/select.py -- <out_dir>

Reads pipeline/data/{structures,deny,bone_mesh_match,bone-fixups}.json.
Writes <out_dir>/select.blend: one parentless object per structure, mesh in world space (the full file
hangs structures off FONT labels, so matrix_world is baked in), modifiers applied, mirrored copies
made single-user with their winding fixed. Also writes <out_dir>/select.json.

Three kinds of object come out, tagged in the custom property za_layer:
  skeleton  exported to skeleton.glb
  muscles   exported to muscles.glb
  ref       full-file bone meshes used only as weighting targets (every rig bone that carries a mesh)
"""
import bpy, sys, json, os, re
import numpy as np

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'pipeline/out'
HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
os.makedirs(OUT, exist_ok=True)

def log(*a):
    print('SEL', *a, flush=True)

S = json.load(open(os.path.join(DATA, 'structures.json')))
DENY = json.load(open(os.path.join(DATA, 'deny.json')))
deny_re = [re.compile(p, re.I) for p in DENY['patterns']]
match = json.load(open(os.path.join(DATA, 'bone_mesh_match.json')))
fix = {k: v for k, v in json.load(open(os.path.join(DATA, 'bone-fixups.json'))).items() if not k.startswith('_')}

def denied(o):
    return o.type in DENY['object_types_denied'] or any(r.search(o.name) for r in deny_re)

want = {}
for layer in ('skeleton', 'muscles'):
    for n in S[layer]['names']:
        want[n] = layer
ref = set(m['full'] for m in match if m['full']) | set(fix.values())
for n in ref:
    want.setdefault(n, 'ref')

dg = bpy.context.evaluated_depsgraph_get()
col = bpy.data.collections.new('Selected')
made, missing, refused = [], [], []
info = {}
for name, layer in sorted(want.items()):
    o = bpy.data.objects.get(name)
    if o is None:
        missing.append(name); continue
    if denied(o):
        refused.append(name); continue
    if o.type != 'MESH' or len(o.data.polygons) == 0:
        missing.append(name + ' (not a mesh with faces)'); continue
    oe = o.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(oe, preserve_all_data_layers=False, depsgraph=dg)
    mw = oe.matrix_world.copy()
    me.transform(mw)
    det = mw.to_3x3().determinant()
    if det < 0:
        me.flip_normals()
    me.name = name
    ob = bpy.data.objects.new(name, me)
    ob['za_name'] = name
    ob['za_layer'] = layer
    col.objects.link(ob)
    co = np.empty(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    me.calc_loop_triangles()
    info[name] = dict(layer=layer, verts=len(me.vertices), tris=len(me.loop_triangles),
                      centroid=[round(float(x), 5) for x in co.mean(0)], mirrored=det < 0,
                      materials=[m.name for m in me.materials if m])
    made.append(ob)

for layer in ('skeleton', 'muscles'):
    miss = [n for n in S[layer]['names'] if n not in info]
    assert not miss, 'missing %s structures: %s' % (layer, miss)
# side check by geometry, not by label: subject's right is -X in both files
for n, i in info.items():
    if i['layer'] in ('muscles', 'skeleton') and n.endswith('.r'):
        assert i['centroid'][0] < 0, '%s labelled right but centroid x=%.3f' % (n, i['centroid'][0])
    if i['layer'] in ('muscles', 'skeleton') and n.endswith('.l'):
        assert i['centroid'][0] > 0, '%s labelled left but centroid x=%.3f' % (n, i['centroid'][0])

log('baked', len(made), {l: sum(1 for i in info.values() if i['layer'] == l) for l in ('skeleton', 'muscles', 'ref')})
log('missing', missing)
log('refused by deny list', refused)
json.dump(dict(structures=info, missing=missing, refused=refused), open(os.path.join(OUT, 'select.json'), 'w'), indent=1)
bpy.data.libraries.write(os.path.abspath(os.path.join(OUT, 'select.blend')), set(made) | {col}, fake_user=True, compress=False)
log('wrote select.blend')
