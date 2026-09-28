# Anatomy pipeline

Turns the Z-Anatomy source files into the GLBs the app loads. The design and its
reasoning live in `docs/knowledge/anatomy-pipeline.md`; this page is how to run it.

```sh
just anatomy          # build everything into pipeline/out/ (about 25 s), check, publish to public/anatomy/, render
just anatomy-check    # only the three.js round-trip check
just anatomy-publish  # only copy the packed GLBs + joint-map.json into public/anatomy/
just anatomy-render   # only the Blender renders
```

Needs Blender 5.2 at `/Applications/Blender.app` (override with `BLENDER=`), Node 24,
and the sources in `pipeline/source/` (never edited). Node tools are pinned in
`pipeline/package.json`, separate from the app's.

## Steps

| Script | Runs on | Does |
|---|---|---|
| `scripts/rig.py` | rig file | REST pose; deletes the T-pose helper armatures, all drivers and constraints (keeping their rotation limits); flattens the rig: `Hips → L5 … T1 → C7 … C1 → Head`, radius and ulna under `RightForeArm`, carpals under `RightHand`, tibia under `RightLeg`; deletes the control bones; turns full inheritance on for every bone (the source switches it off on T12, T3–T1, C6, C2, C1, which three.js can't do). Fails if any REST head or tail moves. 237 → 189 bones. |
| `scripts/select.py` | full file | Bakes the structures in `data/structures.json` to world space, plus every rig bone's full-file mesh as a weighting target. Enforces `data/deny.json`. |
| `scripts/assemble.py` | `out/rig.blend` | Pairs full-file bones with rig bones (`data/bone_mesh_match.json` + `data/bone-fixups.json`, checked by centroid), decimates, skins bones rigidly (1 influence) and muscles with c2 weights, except the muscles in `scripts/bands.py` `SPEC` (rhomboid major and minor, levator scapulae), which get "bands": 4 stretch helper bones per muscle (`MH_<muscle>_<k>`, STRETCH_TO a target `MT_<muscle>_<k>` on the scapula). 189 + 24 = 213 bones. |
| `scripts/joints.py` | `out/assembled.blend` | Measures each movement's bone axis by posing it (breath: each rib's lift axis), lists the bands helpers, poses a probe pose, then writes `out/joint-map.json`. |
| `scripts/export.py` | `out/assembled.blend` | Writes `skeleton.raw.glb` and `muscles.raw.glb`, sharing the same skin. Each has one node per structure, with `extras.za_name`, `ta_name`, `za_layer`, `za_side` and (skeleton) `za_bone`. |
| gltfpack | | `-cc -kn -ke -vpf` (see `justfile`) → `skeleton.glb`, `muscles.glb` |
| `scripts/check.mjs` | packed GLBs | three.js GLTFLoader + MeshoptDecoder in Node. Checks the contract, and repeats joints.py's probe pose in three.js (bone tails must agree with Blender within 0.5 mm). Writes `out/check.json`. |
| `scripts/publish.mjs` | packed GLBs | Puts `asset.copyright` back (gltfpack drops it) and copies `skeleton.glb`, `muscles.glb`, `joint-map.json` into `public/anatomy/`. Fails over 5 MB. |
| `scripts/render.py` | `out/assembled.blend` | Renders REST and a test pose from behind (`out/render_*.png`), posed through `joint-map.json`. Also checks the bands runtime math against Blender and writes `out/helpers-fixture.json` (copy it to `src/core/fixtures/helpers-blender.json` when the helpers change). |

## Contract for the app

- **Bone names** are the rig file's names, unchanged. three.js strips dots and
  spaces from `.name` (`Scapula.r` → `Scapular`); the exact name is in
  `userData.name`, and `joint-map.json` lists both (`three_name`).
- **Axes:** three.js is Y-up, the body faces **+Z**, and the subject's left is +X.
  A movement's `axis_three` is a unit axis in the bone's local frame. A positive
  angle performs the named movement, relative to REST (anatomical position).
  The exporter converts world space only, so bone-local frames are the same in
  Blender and three.js and `axis_three == axis_local`. (An earlier build wrote
  `(a.x, a.z, -a.y)`; it was wrong for every axis not near local X.)
- **Helpers:** `joint-map.json` `helpers` lists the bands bones. The app
  re-creates their STRETCH_TO each frame (`src/core/jointmap.ts` `helperPose`).
- **Structures:** find them by `userData.za_name`. A structure with two
  materials (bone + cartilage, or muscle + tendon) loads as a `Group` holding two
  `SkinnedMesh` children, with the extras on the `Group`. Otherwise the extras
  sit on the `SkinnedMesh` itself.
- **Names that are wrong in the source:** see `data/name-fixups.json` (the
  trapezius "descending" and "ascending" labels are swapped); `ta_name` carries
  the corrected name.
