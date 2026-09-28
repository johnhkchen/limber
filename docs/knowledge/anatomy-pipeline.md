# Anatomy pipeline

How we turn the Z-Anatomy files into the see-through, moving body the app shows.
Written 2026-09-28 from the spike: four scout runs (rig, inventory, budget, skin)
and a critique pass that re-checked their claims. Every number here was measured
in Blender 5.2 or Node unless it says **(open)**. Claims the critique disproved
have been left out or corrected, and each correction is marked.

Spike scripts and data live outside the repo, in the session scratchpad
(`.../scratchpad/spike/{rig,inventory,budget,skin,critique}/`). The pipeline
scripts below should be rebuilt from those scripts, not copied blindly.

---

## Where the body comes from

Two files, both already in `pipeline/source/` (do not modify or re-download):

| File | What it gives us | What it lacks |
|---|---|---|
| `zanatomy/Z-Anatomy/Startup.blend` (307 MB, "full file") | Every structure: 4,569 meshes. Muscles, ligaments, skin patches, bones. | No armature, no rig. |
| `Z-Biomechanics/Startup.blend` (138 MB, "rig file") | The armature `Armature` (237 bones) with 271 bone meshes rigidly parented to it. | No muscles. |

**They share one coordinate space.** The critique checked this vertex by vertex,
with the rig file set to its REST pose: where both files have the same mesh,
the largest per-vertex gap is 0.0004 mm (scapula), 0.0013 mm (fifth rib),
0.0003 mm (T5), 0.0001 mm (femur, tibia, sacrum). The full file's rhomboid
major insertion patch sits 0.00 mm from the rig file's right scapula. So muscles
from the full file drop onto the rig with **no transform**. This holds only in
REST or an identity pose. The rig file opens in a leftover pose that is about
90–100 mm off (see "Things that will bite").

Both files: metres, Z-up, anterior = -Y, the subject's left = +X, armature
world matrix identity. Body is about 1.74 m tall, feet at z ≈ 0. The full file
loads headless in about 3–7 s, not the minute we expected.

### License and credit

The skeleton and muscles we use come from BodyParts3D, mixed and modified by
Z-Anatomy. Everything we ship from them is **CC BY-SA** (share-alike). The app
must show, and each GLB's `asset.copyright` should carry:

> BodyParts3D, © The Database Center for Life Science, CC BY-SA 2.1 Japan.
> Mixed and modified by Z-Anatomy (z-anatomy.com), CC BY-SA 4.0.
> Processed for Limber, CC BY-SA 4.0.

**Correction from the inventory scout:** the licence is *not* clean everywhere.
`pipeline/source/License.txt` lists other models "used as reference/included and
adapted": the University of Dundee inner ear (**CC BY-NC-SA**, non-commercial),
Lissie Cowley's kidney (**CC BY-NC**, non-commercial), and "Brainder" / "White
matter" (no licence stated). The pipeline therefore keeps a **deny list** and
never exports:

- ear and inner-ear structures, including the ossicles (Incus etc.), which the
  rig file parents to the `Head` bone
- kidney, brain, white matter (outside v1 scope anyway)
- all FONT objects, and so the packed fonts (YuMincho, which ships with
  Windows, plus DejaVu, droidsans, KrutiDev010, ScheherazadeNew)
- the 3,839 description texts (Wikipedia, CC BY-SA 3.0, a separate credit
  chain) and the embedded scripts

**(open)** The skin patches, hair and nails look like a different, quad-based
source from BodyParts3D's triangle meshes. That is a guess from mesh style only;
their origin is not stated. Check it before calling the skin layer
BodyParts3D-derived.

---

## What's in each layer

The full file's top collections are flat. The anatomy tree lives in object
parenting: each structure hangs off a FONT label ending in `.g`
(`Rhomboid major muscle.l` ← `Hypaxial muscles of back.g` ← … ←
`Muscular system.g`). The exporter must bake `matrix_world` because the parents
are text labels.

### How objects are picked (all layers)

Keep an object when it is a MESH with faces in the layer's collection and it is
not on the deny list. Drop:

- `.j` / `.i` leader lines (1,605 two-vertex meshes, 0 faces)
- `.g` title meshes, FONT and CURVE objects (the 951 curves are vessels and
  nerves, outside our collections)
- `.t` / `.s` labels

Name quirks to handle: the left copies of `Iliocostalis colli muscle` and
`Intra-articular ligament of head of rib` have no `.l`; `Psoas major.r` has no
"muscle"; `.r` objects are mirror copies that share mesh data with `.l` and have
a negative-scale matrix (the exporter must fix winding, see export).

Region tags (neck, upper back, low back, shoulder, hip, knee) come from the
`Bonus collection` tag tree, which links the same objects into region
collections. 1,585 objects got a region from tags, 717 from their parent's tags,
14 from a bounding box.

### Skeleton

- **Meshes:** the *full file's* bone meshes, not the rig file's.
  **Correction:** the rig scout said every rig-file bone matches the full file
  within 10.9 mm. Per-vertex nearest-neighbour checks show some bones are a
  different mesh version with local gaps up to about 16 mm (hip bone max
  15.8 mm, radius 9.6 mm, humerus 7.8 mm, T8 4.9 mm). The muscles were modelled
  around the full file's bones, so we show those and rigidly re-parent each one
  to its rig bone. The pairing for all 271 rig bone meshes is in
  `spike/rig/bone_mesh_match.json` (248 by name, 23 by nearest centroid:
  `Sternum` = `Body of sternum`, `Heighth rib` = `Eighth rib`, etc.).
- **Golden case:** `Scapula.l/.r`, `Clavicle`, `Humerus`, `First rib` …
  `Twelfth rib` (.l/.r), `Costal cartilage of first rib` … `tenth rib`,
  `Vertebra T1` … `Vertebra T12`, the `Intervertebral disc T1-T2` … discs,
  `Manubrium of sternum`, `Body of sternum`. For the floor poses add
  `Hip bone`, `Sacrum`, `Femur`, `Patella`, `Tibia`, `Fibula`, and the foot and
  hand bones.
- Source size: 277 objects, 599k tris.

### Muscles

- **Golden case:** `Rhomboid major muscle` (4,800 polys), `Rhomboid minor muscle`
  (1,494), trapezius as three parts — `Descending part of trapezius muscle`
  (6,760), `Transverse part …` (2,992), `Ascending part …` (4,596) —
  `Levator scapulae` (3,082), `Serratus anterior muscle` (25,240),
  `Serratus posterior superior/inferior muscle`, the erector spinae group
  (`Iliocostalis colli/thoracis/lumborum muscle`,
  `Longissimus capitis/colli/thoracis muscle`,
  `Spinalis capitis/colli/thoracis muscle`, 79k tris together), and the three
  rib layers `External intercostal muscles` (41,357), `Internal intercostal
  muscles` (40,184), `Innermost intercostal muscles` (38,254). All .l/.r.
- **Other v1 regions** are picked by region tag. Names already confirmed:
  sternocleidomastoid, longus colli/capitis, scalenes, splenius, suboccipitals,
  multifidus, rotatores, quadratus lumborum, `Psoas major`, iliacus, the rotator
  cuff, glutes, piriformis, hamstrings, quads.
- Source size: 669 objects, 2.14M tris (about 70% of all geometry).

### Tendons and ligaments

- **Tendons are not separate objects.** They are faces inside the muscle meshes
  that use the `Tendon` material: 441k of 2.05M muscle faces, across 243
  muscles. We split them out by material index. **(open)** The critique did not
  re-run this count.
- **Ligaments** come from `3: Joints`. Most are open sheets that only get volume
  from their SOLIDIFY modifier, so we apply SOLIDIFY at export.
- **Golden case:** `Costotransverse ligament` (44 polys), `Radiate ligament of
  head of rib` (144), `Intra-articular ligament of head of rib` (9), plus
  `External/Internal intercostal membrane`. Each rib-joint ligament is **one
  object covering every rib level** (z 1.14–1.44 m). To light up "the rib joint
  at T5", these must be split per level. There are no joint-capsule meshes for
  the rib joints; those names are labels only.
- **Knee:** `Anterior/Posterior cruciate ligament`, `Fibular collateral ligament`
  (3 polys), `Superficial/Deep part of tibial collateral ligament` (6 / 10),
  menisci, `Iliotibial tract` (48,612, all tendon). **There is no patellar
  ligament body in either file**, only its origin/insertion patches
  (`Patellar ligament.ol/.el/...`). We will need to model a simple strap between
  those patches.
- **Fascia** (thoracolumbar layers etc.) rides in this layer too.
- `2: Muscular insertions` (705 thin origin/insertion patches on the bones) is
  **not** a display layer. We may use it as data (where a muscle attaches).

### Skin

There is no whole-body skin mesh. `9: Regions of human body` has 242 low-poly
skin patches (about 25k faces). Welded, they make one shell: 3 islands at
0.1 mm, 1 island at 1 mm, with 676–846 open edges left (eyes, mouth, nails,
small gaps). That is fine for a see-through shell. Drop hair, eyebrows, lashes
and nails.

The budget run built this shell (`skinshell.blend`, 49,779 tris), but it shows a
**seam down the spine and shading patches** at the right scapula and knee. Fix
before shipping: weld along x = 0, recompute normals, log open-edge counts.

---

## The skeleton that moves

### Which armature

Use `Armature` from the rig file. Ignore and delete `AnatPoseToTPose` and
`TPoseToAnatPose`: they sit outside the view layer, are offset up to 1.16 m, and
exist only to retarget T-pose motion-capture clips.

Facts (confirmed by the critique):

- 237 bones, 199 deform. No IK, no skinned meshes, no vertex groups.
- Rest pose = anatomical position (arms at sides, palms forward).
- The body is driven by 31 motion-capture-named bones (`Hips`, `LowerBack`,
  `Spine`, `Spine1`, `Neck1`, `Head`, `RightShoulder`, `RightArm`,
  `RightForeArm`, `RightHand`, `RightUpLeg`, `RightLeg`, `RightFoot`, and the
  left twins). The anatomical bones follow through constraints: 153 limit
  rotation, 89 copy rotation, 24 armature, 21 stretch-to, 10 damped track,
  8 locked track.
- Shoulder chain: `Sternum` → `Clavicle-Z.r` → `Clavicle-X.r` → `Scapula.r` →
  `RightArm` (humerus). The clavicle bones point at `RightShoulder`, so
  `RightShoulder` is how you elevate or protract the shoulder girdle.
  `Scapula.r` has no constraints and can be rotated freely.
- Elbow = `RightForeArm` (Z flexion -18..140°, Y pronation -180..0°).
  Knee = `RightLeg` (X, negative = flexion, -165..0°). Hip = `RightUpLeg`.
  Ankle = `RightFoot`.
- Ribs: `RibN-Start.l/r` are children of vertebra `TN`. Ribs follow a `Breath`
  control bone that tilts the sternum: ribs 1–2 copy 100% of the tilt, falling
  to 20% at rib 10. Ribs 11–12 hang straight off T11/T12.

### Constraints don't travel

glTF carries bones, not constraints. If we export the rig as it is and set only
the 31 control bones in the browser, the vertebrae, ribs, clavicles and forearm
bones will not move. So the pipeline **flattens the rig into a plain chain that
the browser can pose directly**, and re-creates the few couplings we need in
`src/core/`:

1. Vertebrae: re-parent L5 → … → T1 → C7 → … → C1 into one chain (today they
   are all parentless roots). Each vertebra takes a share of the trunk rotation
   (see the spine section below).
2. Ribs: keep `RibN-Start` under vertebra `TN`. Breath becomes a
   per-rib X rotation in `src/core/` using the file's own shares (1.0, 1.0, 0.9,
   0.8 … 0.2 for ribs 1–10).
3. Clavicle and scapula: replace the locked-track with plain FK rotation on
   `Clavicle-Z/X` and `Scapula`.
4. Forearm, knee and finger couplings: bake to plain FK (radius follows
   pronation; tibia follows `RightLeg`).
5. Delete all constraints and all drivers, then check that the REST pose has not
   moved (vertex diff 0).

**(open)** None of this flattening has been built. The fallback is to keep the
constraint rig and bake each exercise to keyframes in Blender (Bake Action with
visual keying), shipping clips instead of live pose math. That contradicts the
plan's "pose math in `src/core/`", so try flattening first.

### The spine needs rebuilding

This is the biggest gap for the golden case. Open book, thread the needle and
child's pose all need segmental thoracic rotation and flexion.

- The thoracic spine moves as **one rigid block**. Twisting `Spine` +20° gives
  6.0°, and T12, T8, T7, T6 and T1 all turn exactly 6.0°.
- Block twist is limited to ±6° per block (`Spine`, `Spine1`), about 17° in
  total with `LowerBack`. Real thoracic rotation is 30–45°.
- Each vertebra's own limit is about ±2–4°, and turning one vertebra does not
  carry the ones above it.
- **Correction:** the rig scout said L5–L1 follow only `LowerBack`. In fact L1
  moves when only `Spine` turns (5.2° at the limit, 17.3° of 20° unlimited).
  The armature constraint seems to blend by position. L2–L5 are unchecked.
- **Correction:** muting a limit constraint from a script does nothing (about
  243 drivers toggle the mute flags and override it). Setting the constraint's
  influence to 0, or deleting it, works (+20° in gives 20° out). The flattening
  step deletes them anyway.

The flattened chain will let `src/core/` spread a trunk angle over T1–T12 (for
example evenly, or weighted to the mid-thoracic levels) and the ribs follow
because they are children of each vertebra. **(open)** Not yet built or tested.

### The shoulder blade floats

Nothing keeps the scapula on the ribcage. It swings on the clavicle plus its own
free rotation. Across-body reach and ball release protract it a lot. We need
either a small glide correction in `src/core/` or a penetration check (scapula
vs ribs) on every exercise clip. **(open)**

### Rest pose and alignment

- Always set `Armature.data.pose_position = 'REST'` (or clear the pose) before
  measuring, binding or exporting. The file opens at frame 61 in a leftover pose
  (whole body about 9 cm off, forearms turned).
- **Bind muscles at REST, not at the identity pose.** The skin scout bound at
  identity. Identity differs from REST by up to 16.8 mm, only in the hands
  (forearm tracking adds 1.8–3.4° of wrist offset). Flattening removes that
  offset, after which identity = REST.
- No coordinate transform between the two files. Blender's glTF exporter
  converts Z-up to glTF's Y-up on the way out; **(open)** confirm in a three.js
  round trip that the body faces +Z and left is +X.
- Some bone meshes carry an object scale of 10 (e.g. `Scapula.r`, `Sacrum`), and
  every `.r` mirror has negative scale. Apply transforms before export.

### Bones the browser sees

Export the deforming bones only. The skin scout's test used 179 bones (those
that carry a rigid mesh). three.js packs bone matrices into a float texture
(237 bones fit a 32×32 texture, 16 KiB), so bone count is not a phone limit.

Keep the rig file's bone names exactly. Name quirks to carry in a fix-up table,
never by string guessing: unsuffixed hand/foot phalanx and metacarpal names are
**right** and `.001` names are **left**; `Third metacarpal bone.l` is actually
right; bone `Patella.l.001` is the right patella; `Ulna.r` sits in the Left
collection.

---

## How each layer follows the bones

| Layer | Method | Why |
|---|---|---|
| Skeleton | **Rigid.** Each bone mesh is a child node of its bone. No skinning. | Matches how the source is built. Cheapest on a phone. |
| Muscles | **Skinned**, 4 influences max, method chosen per muscle (below). | Muscles bend and stretch. |
| Tendons | Skinned with the same weights as the muscle they came from. **(open)** Untested. | They are part of the muscle mesh. |
| Ligaments, fascia | Skinned, probably with the bone-distance method below. **(open)** Untested; rib-joint ligaments need per-level splitting first. | Short sheets between two bones. |
| Skin | Skinned. **(open)** Only tiny skin patches were tested, never the whole shell. | Covers every joint. |

Four influences is a hard limit: the three.js GLTFLoader only reads `JOINTS_0`
and `WEIGHTS_0`, and the shader uses a vec4. Trimming to the top 4 looked fine.

### What we measured for muscles

16 right-side back/thorax muscles in a strong across-body reach pose (the
scapula protracted nearly edge-on):

| Method | Result |
|---|---|
| Blender automatic (heat) | **Don't use.** Failed silently on 3 of 16 meshes, leaving 24,786 vertices with no weight, frozen in place. |
| Blender envelope | **Don't use.** Meshes drift 50–350 mm off the bones, volume drops to 0.46×. |
| Distance to bone *lines* | Fast (0.04 s) but tears; rhomboid drifts 63 mm. |
| **Distance to bone *surfaces*** (call it "c2": inverse distance, power 4, 5 smoothing passes, top 4) | Default for now. Attachment points stay on bone (median 1.1 mm), 0.3–0.8 s per muscle at ~2k vertices. But about 12% of edges over-stretch or squash, with creasing where trapezius and rhomboid meet the scapula. |
| Harmonic (fixed at bone contacts, smooth between) | 8.5% bad edges, slowest (28 s for 16). |
| From insertion patches | 7.7% bad edges; latissimus drifts 55 mm. |
| Origin bone + insertion bone + stretch helper ("m") | Most even stretch (1.4% bad edges, volume 0.89–1.14), but wide fan muscles pull off their attachments (latissimus 69 mm, rhomboid major 33 mm) and it needs a stretch-to constraint baked. |

**Correction:** the skin scout called c2 "robust, within 5 mm, never tears." The
drift number is measured only on vertices that already touch bone, which c2
pins to that bone by construction, so it says little about the muscle's body.
On the golden muscle itself c2 is poor: **rhomboid major 21% bad edges and
2.04× volume**, rhomboid minor 24% and 1.90×, levator scapulae 18.5% and
1.54×. **No method handles rhomboid major well yet.** External intercostals go
from 4.7% of vertices inside bone at rest to 18.1% posed (shallow, p95 1.8 mm).

Plan: c2 as the default for sheets and rib-attached muscles; m for spindle
muscles that run between two bones (levator scapulae, spinal erectors, arm
muscles) once its helper bone is flattened into plain FK; then try a hybrid
(pin bone contacts, interpolate along origin → insertion) aimed at the
rhomboids. Judge methods by interior penetration into bone and neighbouring
muscles plus a manifold-safe volume, not by contact drift.

Every weighting run checks: zero-weight vertices = 0, influences ≤ 4, weights
sum to 1.

---

## Shrinking it for a phone

The plan's budget is 5–8 MB compressed. **Download size is not the tight
limit; drawing cost is.** All sizes below are measured, after gltfpack with
names kept (quantized, meshopt-compressed), static (no bone weights yet):

| Layer | Source tris | Phone mix tris | Raw KB | Brotli KB |
|---|---|---|---|---|
| Muscles | 2,002,640 | 230,447 | 1,386 | 779 |
| Skeleton | 678,415 | 60,967 | 444 | 197 |
| Ligaments (joints) | 358,055 | 49,727 | 538 | 204 |
| Fascia | 320,959 | 22,306 | 227 | 90 |
| Skin shell (full detail) | 49,779 | 49,779 | 223 | 145 |
| **Total** | | **413,226** | **~2,800** | **~1,415** |

Phone mix rules (Blender decimate ratio, 48-tri floor per object): muscles 0.1,
intercostals 0.25, head muscles 0.05; bones 0.1, skull and teeth 0.05; ligaments
0.1; fascia 0.05. A richer "hi" mix (muscles/bones/ligaments 0.25, intercostals
0.5, fascia 0.1) is about 912k tris and 2.85 MB brotli, still inside budget.

What we'll ship first:

- **Muscles:** phone mix, with the golden-case muscles (rhomboids, serratus
  anterior, trapezius, levator scapulae, erector spinae) raised to 0.25. Back
  muscles hold up to about 0.1; below that the spine midline cracks and
  intercostals get spiky.
- **Skeleton:** 0.25 for scapula, thoracic vertebrae, ribs and cartilages,
  humerus, pelvis, femur, tibia; 0.1 elsewhere; 0.05 skull and teeth.
- **Ligaments** 0.1, **fascia** 0.05.
- **Skin shell** at 0.5 (24,889 tris, 85 KB brotli) once the seam is fixed.
- Bone weights add about 8–16 bytes per vertex before compression. The one
  skinned test (16 muscles, ~2k vertices each, 179 joints) was 1.40 MB raw and
  357 KB after gltfpack.

Open for the phone: frame time with transparent layers stacked (every hidden
layer still draws), 1,365 separate meshes as draw calls, GPU skinning of 200k+
vertices, and memory after decoding. **Nothing has run on a real phone yet.**

---

## What comes out

One GLB per layer, lazy-loaded in this order: `skeleton.glb`, `muscles.glb`,
`connective.glb` (tendons, ligaments, fascia), `skin.glb`.

- **Same bone names in every file.** Each file carries the same joint list;
  the app binds all skinned meshes to one shared skeleton by name. **(open)**
  Rebinding across files is untested.
- **One node per structure**, with `extras.za_name` (the Z-Anatomy name),
  `extras.za_layer`, `extras.za_groups`, and later side and region. The budget
  run showed gltfpack with keep-names (`-kn`) keeps 100% of these (511/511
  muscles, 413/413 ligaments).
- **Skinning:** `JOINTS_0` / `WEIGHTS_0`, 4 influences, weights normalized.
- **Materials:** our own flat palette (bone, cartilage, muscle, tendon,
  ligament, skin). The source's "comic shader" node groups don't survive glTF,
  and their key colours (magenta, green) are not display colours. Strip the
  extra `KHR_materials_specular/anisotropy/ior` the exporter adds.
- **gltfpack flags:** pin them in the justfile. The `__knlo` and `__kn_c`
  variants' flags were not recorded. **(open)** The skinned test file had its
  16 muscles merged into 2, which loses per-muscle identity; find the flags
  that keep skinned meshes separate.

Picking and highlighting: v1 uses node-per-structure (proven) and cuts draw
calls at runtime with `BatchedMesh` if frame time needs it. **Correction:** the
budget scout said structure IDs packed into `TEXCOORD_0.u` did not survive
gltfpack. They did: decoding the buffer directly gives 511 distinct IDs for
muscles and 269 for bones; the Blender importer check rounded them away. It is
fragile (12-bit, the decoder must know the count, max 4,096), so keep it as a
fallback; a real integer attribute is the better long-term choice.

---

## The exercise file: which joints, which numbers

Exercise JSON talks in **plain joint movements in degrees**, not bone-local
axes. A table in the pipeline (`joint-map.json`, generated and checked against
the rig) turns each movement into a bone and a local axis. That keeps exercise
files stable if the rig changes, and keeps them writable by a person or a
model.

Joints exposed (each with .l / .r where it applies):

| Joint | Bone(s) | Movements (degrees) |
|---|---|---|
| `pelvis` | `Hips` | position (metres), tilt, turn, side-bend |
| `lowBack` | `LowerBack` → L5–L1 | flexion, rotation, sideBend |
| `upperBack` | T12–T1 (spread by `src/core/`) | flexion, rotation, sideBend |
| `neck` / `head` | `Neck1` → C7–C1, `Head` | flexion, rotation, sideBend |
| `shoulderGirdle` | clavicle (from `RightShoulder`) | elevation, protraction |
| `scapula` | `Scapula` | upwardRotation, tilt |
| `shoulder` | `RightArm` | flexion, abduction, rotation, horizontalAdduction |
| `elbow` | `RightForeArm` | flexion (Z), pronation (Y) |
| `wrist` | `RightHand` | flexion, deviation |
| `hip` | `RightUpLeg` | flexion, abduction, rotation |
| `knee` | `RightLeg` | flexion (X, negative in Blender) |
| `ankle` | `RightFoot` | dorsiflexion |
| `breath` | ribs 1–10 via shares | 0 = out, 1 = full in |

Known axis facts: elbow flexion is local Z and pronation local Y; knee flexion
is local X, negative. **(open)** The other axis meanings (which humerus axis is
flexion vs abduction, sign conventions for scapula and trunk) must be measured
into `joint-map.json`, not assumed. The rig file's own limits become the
clamps.

Sketch for the across-body reach (right arm). The pose numbers are the skin
scout's test pose, which rendered sensibly; the breath track is the case's
"5 slow, deep breaths":

```json
{
  "id": "across-body-reach",
  "side": "right",
  "highlight": ["Rhomboid major muscle.r", "Rhomboid minor muscle.r",
                "Costotransverse ligament.r"],
  "keyframes": [
    { "t": 0,   "pose": {} },
    { "t": 2.0, "pose": {
        "upperBack":        { "flexion": 12, "rotation": -10 },
        "shoulderGirdle.r": { "protraction": 20 },
        "scapula.r":        { "upwardRotation": 10 },
        "shoulder.r":       { "flexion": 90, "horizontalAdduction": 40 },
        "elbow.r":          { "flexion": 10 }
    } }
  ],
  "hold": { "from": 2.0, "breaths": 5, "breathSeconds": 6 },
  "breath": { "track": "hold", "min": 0, "max": 1 },
  "cues": [
    { "t": 2.0, "text": "Let the blade slide outward, away from the spine." }
  ]
}
```

Times in seconds. Angles are relative to REST (anatomical position). Missing
joints stay at REST. `src/core/` interpolates, clamps to the rig limits, spreads
`upperBack` across T1–T12 and applies breath to the ribs.

**Keep breath small.** In the unflattened rig the clavicles hang off the
sternum, so 5 cm of `Breath` moved the right hand 102.6 mm. **(open)** The
critique did not re-run that number. Flattening should decouple the arm from the
ribs; check it.

---

## `just anatomy`: the steps

Scripts in `pipeline/scripts/`, run headless
(`/Applications/Blender.app/Contents/MacOS/Blender -b <file> --python <script>`).
Outputs go to `pipeline/build/` (gitignored), final GLBs to `static/anatomy/`.
Times are rough, based on spike runs on this Mac.

| # | Step | What it does | Rough time |
|---|---|---|---|
| 1 | `select.py` (full file) | Pick objects per layer by collection, kind and region; apply deny list; split tendon faces by material; apply SOLIDIFY on ligaments; bake transforms and fix `.r` winding; write `structures.json`. | ~30 s |
| 2 | `skin_shell.py` | Join and weld the 242 skin patches, fix the midline seam, recompute normals, log open edges. | ~20 s |
| 3 | `rig.py` (rig file) | REST pose, delete helper armatures, flatten the rig (vertebra chain, FK clavicle/scapula, bake couplings), delete constraints and drivers, check REST unchanged. | ~30 s |
| 4 | `assemble.py` | Bring layers into the rig file; rigid-parent full-file bones to rig bones via the match table; write `joint-map.json`. | ~30 s |
| 5 | `decimate.py` | Per-structure ratios (phone mix + golden overrides), 48-tri floor. | ~1 min |
| 6 | `weight.py` | Per-muscle method (c2 / m), top-4, normalize; checks for zero weights and >4 influences. | ~1–3 min at phone density |
| 7 | `export.py` | One GLB per layer, `extras.za_*`, palette, 4 influences, copyright. | ~30 s |
| 8 | `pack` (gltfpack) | Pinned flags, names kept, skinned meshes not merged. | ~10 s |
| 9 | `check.mjs` (Node) | Load each GLB with three.js loaders; count structures vs `structures.json`, joints, influences; sizes raw/brotli; fail over budget. | ~10 s |
| 10 | `sheet.py` | Contact sheet of REST plus each exercise's key pose, with a scapula-vs-rib penetration count. | ~1 min |

Whole run: roughly 5–8 minutes. Cache step outputs so changing a ratio doesn't
rerun selection.

---

## Things that will bite

- **Leftover pose.** Forget REST and everything is 9 cm off the muscles.
- **Rigid thoracic spine.** Without the rebuild, three of the five golden
  exercises can't be shown honestly.
- **Rhomboid major deforms badly** under every weighting method tried. It is the
  muscle the golden case is about.
- **Floating scapula** can sink into or lift off the ribs in protraction.
- **Draw calls and overdraw** on phones, untested.
- **Left/right naming errors** in both files. Match by geometry or the fix-up
  table, never by string.
- **Broken drivers:** 122 of 319 point at bones that no longer exist. Deleting
  all drivers in step 3 removes the risk. **(open)** The count was not
  re-checked by the critique.
- **Licence:** the deny list must be enforced by the pipeline, not by memory.
- **Patellar ligament missing**; knee exercises need a modelled strap.

## Still open

1. Does the flattened FK rig reproduce the constraint rig's poses closely enough
   (compare vertex positions at the 8 stored full-rig poses: Anatomical
   position, Foetal, Push up ×2, Relax, Walk, Yoga-flex, Yoga-stretch)?
2. How to spread trunk rotation over T1–T12, and does each rib follow its
   vertebra cleanly?
3. A weighting method that keeps the rhomboids' shape.
4. Weights for the left side, hips, knees and glutes; ligaments; the skin
   shell. None exist yet. Deep hip and knee flexion (child's pose) untested.
5. Axis meanings for every joint in `joint-map.json`.
6. gltfpack flags that keep skinned meshes separate and names intact.
7. One shared skeleton across four lazy-loaded GLBs in three.js.
8. Frame time on a real mid-range phone with all layers see-through.
9. Provenance of the skin, hair and nail surfaces.
10. Plain names for the UI ("rhomboids" → "the muscles between your shoulder
    blade and spine") and the per-structure metadata (layer, region, side,
    related exercises).

## Next step

Build steps 3, 4, 6, 7 and 9 for the golden subset only, right side:

1. `rig.py`: flatten the rig (vertebra chain, FK clavicle and scapula, delete
   constraints and drivers), check REST is unchanged to 0.01 mm.
2. `assemble.py`: full-file scapula, clavicle, humerus, ribs, cartilages,
   T1–T12 and sternum rigid on the rig bones; rhomboids, trapezius, levator,
   serratus and erectors at the phone ratio, c2 weights at REST.
3. Export `skeleton.glb` and `muscles.glb`, pack, and load both in Node with
   three.js to confirm names, extras, joint count and facing.
4. Pose the across-body reach from the JSON above in a bare Threlte page with
   the rhomboids highlighted, and time it on a phone.

That is build-order step 1 in `plan.md`, and it answers open questions 1, 2, 6,
7 and 8 at once.

---

## Found while wiring the slice together (2026-09-28)

Measured during the integration run; the pipeline and app already follow these.

- **Bone-local frames are the same in Blender and three.js.** The glTF exporter
  converts world space only (a bone's world rotation in three.js is C·R_blender),
  so a bone-local axis needs no conversion: `axis_three == axis_local`. The first
  build wrote `(a.x, a.z, -a.y)`, which looked right for shoulder flexion (near
  local X either way) and was wrong for horizontal adduction, the trunk and the
  scapula. `check.mjs` now repeats a compound probe pose from `joints.py` in
  three.js and fails if bone tails disagree by more than 0.5 mm (they agree to
  0.001 mm).
- **Inheritance.** The source rig switches rotation inheritance off on T12,
  T3–T1, C6, C2, C1 and the thyroid, and local location off on the metatarsals.
  glTF can't express that, so Blender renders and the browser disagreed.
  `rig.py` now turns full inheritance on for every bone (REST unchanged).
- **Rhomboids use "bands"** (`pipeline/scripts/bands.py`, from the rhomboid
  spike): rhomboid major, rhomboid minor and levator scapulae get 4 stretch
  helper bones each. The app re-creates Blender's STRETCH_TO per frame
  (`src/core/jointmap.ts` `helperPose`, tested against Blender to < 1e-4).
- **Outputs** go to `pipeline/out/`, and `just anatomy-publish` copies the two
  GLBs and `joint-map.json` to `public/anatomy/` (Vite's folder, not
  `static/anatomy/`), restoring `asset.copyright`, which gltfpack 1.3.0 drops.
- **Floating scapula, in numbers** (`src/app/body.test.ts`): at REST the blade
  sits 4.6 mm off the nearest right rib. The golden exercise's pose keeps it at
  7.4 mm (8.1 at the top of a breath) with zero rhomboid points inside a rib,
  and moves the blade 30 mm further from the spine. Stronger protraction (22°)
  or pressing the blade in (scapula internalRotation −6°) makes ribs poke
  through the rhomboid (14–33 points), so the pose was tuned to avoid that. A
  real glide constraint is still open.
- **The skeleton needs the whole chain the muscles hang from.** The first slice
  stopped at C7 and the humerus, so the upper trapezius and levator scapulae
  (weighted to C1–C4 and `Head`) stood in empty air, and every hand cue had no
  hand. `structures.json` now carries the right radius, ulna and all 27 hand
  bones (0.25), C1–C6 (0.25) and a toothless skull (occipital, parietals,
  frontal, temporals, sphenoid, zygomatics, maxillae, nasals, mandible; 0.05).
  The rig already had every bone they bind to; no code changed. Skeleton went
  from 72 to 121 structures and 552 KB to 684 KB packed (whole publish 1.23 MB).
