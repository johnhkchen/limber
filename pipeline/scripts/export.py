"""Step 5: export skeleton.glb and muscles.glb from the assembled rig.

Run:  Blender -b <out>/assembled.blend --python pipeline/scripts/export.py -- <out_dir>

Both files carry the same armature (all 189 flattened bones, same names, REST pose) so the app can bind
every layer to one shared skeleton by name. Each structure is its own node with
extras.za_name / za_layer / za_bone (skeleton) and a skinned mesh (skeleton: 1 influence; muscles: <=4).
Mesh nodes are named "<za_name> mesh" so they never collide with a bone name after three.js strips the
dots from node names (bone "Scapula.r" and mesh "Scapula.r" would both become "Scapular").
"""
import bpy, sys, os, json

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'pipeline/out'
COPYRIGHT = ('BodyParts3D, (c) The Database Center for Life Science, CC BY-SA 2.1 Japan. '
             'Mixed and modified by Z-Anatomy (z-anatomy.com), CC BY-SA 4.0. Processed for Limber, CC BY-SA 4.0.')

def log(*a):
    print('EXP', *a, flush=True)

arm = bpy.data.objects['Armature']
arm.data.pose_position = 'REST'
for pb in arm.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
bpy.context.view_layer.update()

HERE = os.path.dirname(os.path.abspath(__file__))
FIX = {k: v for k, v in json.load(open(os.path.join(HERE, '..', 'data', 'name-fixups.json'))).items() if not k.startswith('_')}

layers = {'skeleton': [], 'muscles': []}
for o in bpy.data.objects:
    if o.type == 'MESH' and o.get('za_layer') in layers:
        o.name = o['za_name'] + ' mesh'
        o.data.name = o.name          # mesh names share three's unique-name pool with bones
        side = 'right' if o['za_name'].endswith('.r') else 'left' if o['za_name'].endswith('.l') else 'mid'
        o['za_side'] = side
        o['ta_name'] = FIX.get(o['za_name'], o['za_name'])   # corrected name where the source label is wrong
        # drop UV maps and colour attributes: the palette is flat, UVs only add bytes
        for uv in list(o.data.uv_layers):
            o.data.uv_layers.remove(uv)
        for ca in list(o.data.color_attributes):
            o.data.color_attributes.remove(ca)
        layers[o['za_layer']].append(o)

sizes = {}
for layer, objs in layers.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    path = os.path.abspath(os.path.join(OUT, layer + '.raw.glb'))
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True,
        export_skins=True, export_def_bones=False, export_influence_nb=4, export_all_influences=False,
        export_rest_position_armature=True, export_animations=False, export_apply=False,
        export_yup=True, export_extras=True, export_copyright=COPYRIGHT,
        export_normals=True, export_texcoords=False, export_tangents=False,
        export_materials='EXPORT', export_image_format='NONE',
        export_cameras=False, export_lights=False)
    sizes[layer] = os.path.getsize(path)
    log(layer, len(objs), 'meshes ->', path, sizes[layer], 'bytes')
json.dump(sizes, open(os.path.join(OUT, 'export.json'), 'w'), indent=1)
