set shell := ["bash", "-euo", "pipefail", "-c"]

# What's here
default:
    @just --list

# --- web app ---

# Install JS dependencies
install:
    npm ci

# Run the page locally (http://localhost:5173)
dev:
    npm run dev

# Typecheck and run the core tests
check:
    npm run check

# Build the page into dist/
build:
    npm run build

# Screenshots at phone and laptop size (needs `just build`; set SHOTS_DIR to choose where)
shots:
    npm run shots

# Pull the shared b28 clay kit into the app
sync-kit:
    curl -fsS https://b28.dev/kit/b28-clay.css -o src/app/styles/b28-clay.css
    @echo "src/app/styles/b28-clay.css synced from https://b28.dev/kit/"

# ---------------------------------------------------------------- anatomy pipeline (pipeline/, outputs in pipeline/out/)
blender := env_var_or_default("BLENDER", "/Applications/Blender.app/Contents/MacOS/Blender")
anat_out := "pipeline/out"
rig_src := "pipeline/source/Z-Biomechanics/Startup.blend"
full_src := "pipeline/source/zanatomy/Z-Anatomy/Startup.blend"
# gltfpack flags, pinned (gltfpack 1.3.0, pipeline/package.json):
#   -cc   meshopt compression (higher ratio)      -kn  keep named nodes -> one mesh per structure (without it 13 muscles merge into 1)
#   -ke   keep extras (without it za_name is lost, even with -kn)
#   -vpf  float positions: no dequantization child node, so extras stay on the mesh node itself (~6% more brotli bytes)
gltfpack_flags := "-cc -kn -ke -vpf"

# Build skeleton.glb + muscles.glb (full skeleton, back muscles both sides) from the Z-Anatomy sources
anatomy: anatomy-deps
    mkdir -p {{anat_out}}
    {{blender}} -b {{rig_src}} --python-exit-code 1 --python pipeline/scripts/rig.py -- {{anat_out}} 2>&1 | grep -E '^RIG|Traceback|Error:|assert' | grep -v PyDriver
    {{blender}} -b {{full_src}} --python-exit-code 1 --python pipeline/scripts/select.py -- {{anat_out}} 2>&1 | grep -E '^SEL|Traceback|Error:|assert' | grep -v PyDriver
    {{blender}} -b {{anat_out}}/rig.blend --python-exit-code 1 --python pipeline/scripts/assemble.py -- {{anat_out}} 2>&1 | grep -E '^ASM|Traceback|Error:|assert'
    {{blender}} -b {{anat_out}}/assembled.blend --python-exit-code 1 --python pipeline/scripts/joints.py -- {{anat_out}} 2>&1 | grep -E '^JNT|Traceback|Error:|assert'
    {{blender}} -b {{anat_out}}/assembled.blend --python-exit-code 1 --python pipeline/scripts/export.py -- {{anat_out}} 2>&1 | grep -E '^EXP|Traceback|Error:|WARNING'
    for f in skeleton muscles; do pipeline/node_modules/.bin/gltfpack -i {{anat_out}}/$f.raw.glb -o {{anat_out}}/$f.glb {{gltfpack_flags}} -v | grep -E '^output: [0-9]+ nodes|^input: [0-9]+ nodes'; done
    just anatomy-check
    just anatomy-publish
    just anatomy-render

# Load the packed GLBs with three.js GLTFLoader + MeshoptDecoder in Node and assert the contract
anatomy-check: anatomy-deps
    node pipeline/scripts/check.mjs {{anat_out}}

# Copy the packed GLBs + joint-map.json into public/anatomy/ for the app (restores asset.copyright)
anatomy-publish:
    node pipeline/scripts/publish.mjs {{anat_out}} public/anatomy

# Render REST, the golden test pose and a kneeling-ish whole-body pose (flattened rig) to pipeline/out/render_*.png
anatomy-render:
    {{blender}} -b {{anat_out}}/assembled.blend --python-exit-code 1 --python pipeline/scripts/render.py -- {{anat_out}} 2>&1 | grep -E '^RND|Traceback|Error:'

anatomy-deps:
    test -d pipeline/node_modules/three || (cd pipeline && npm ci --no-audit --no-fund)
