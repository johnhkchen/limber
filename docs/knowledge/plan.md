# Plan

Decisions from the kickoff, 2026-09-28. Revised the same day after the case
study and the generative UI brief came in.

## What it is

A self-help helper for common aches, in three parts:

1. **Anatomy** — a real, moving human body you can see through: skin → muscles
   → tendons → skeleton. It does each exercise, and the structures that matter
   light up.
2. **Pinpoint** — body map + questions → patterns that often match, with how
   sure. Screens are built by decision-driven generative UI
   (`generative-ui.md`).
3. **Videos** — hand-picked links per exercise.

The first golden case is `cases/right-shoulder-blade.md`.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Name | **Limber** → `limber.b28.dev`, `github.com/johnhkchen/limber` (public) | Warm, grab-able. |
| Anatomy source | **Z-Anatomy** (CC BY-SA 4.0, derived from BodyParts3D CC BY-SA 2.1 JP). Start from the source .blend, not the nqwrc export (that one is NC because of two organs). Only skeleton, muscles, tendons/ligaments, skin. | Open, layered, names structures in Terminologia Anatomica. |
| Rig | **Headless Blender pipeline in the repo** (`pipeline/`): select structures → decimate → fit a humanoid armature → bones rigid-parented to joints → muscles skin-weighted → export skinned GLB with `extras.za_name` → gltfpack. Blender is at `/Applications/Blender.app`. | The whole body moves, so see-through layers work during motion. |
| Exercises | JSON keyframes of armature joint angles + cues + breath timing. Pose math in `src/core/`. | Model-authorable, testable. |
| Renderer | Svelte 5 + Vite + **Threlte**. | DX. Core stays framework-free. |
| Pinpoint | Body map + questions. Deterministic red-flag gate first. Then **Jev** via **native BAML nightly** (`typesafeai` client), through Cloudflare Workers AI with the same account/token as tech-explorer. | Jev's probabilities → honest "how sure." |
| Generative UI | Decision-driven: Jev picks catalog components, highlights, exercises. Code assembles. `none_fit` → browse screen + gap log. **No runtime LLM in v1.** | Cheap, fast, safe. No premature fallbacks. |
| Videos | Hand-picked in `content/`. Link checker in CI. | Quality over coverage. |
| Scope v1 | Neck, upper back, low back, shoulder, hip, knee. | Broad from day one. The case study is upper back. |
| Device | **Phone first.** 3D budget ~5–8 MB compressed, layers lazy-loaded, touch orbit. | People do these on the floor. |
| Backend | Cloudflare Worker: static assets + `/api/ask` (rate-limited like Magpie's `ASKS`). Secrets from Doppler `blanksy-tenants/prd_b28`. | Same family as Magpie. |
| Process | Built directly in session, no vend/lisa board. | |
| Licenses | Code MIT. Processed anatomy assets CC BY-SA 4.0 with credit on the page. | Share-alike carries over. |
| Look | b28 palette (steel `#44679b`, off-white `#faf8f5`, Lora/Karla). | Brand family. |

## Safety notes

- Not medical advice. Say so plainly, without scary legal walls.
- Red flags short-circuit to "get seen": for the case study, breathlessness,
  racing heart, coughing blood, swollen calf, fever, constant pain with nausea.
  Per region, plus the usual spine ones (bladder/bowel changes, saddle
  numbness, trauma, progressive weakness, unexplained weight loss).
- Never say "diagnosis." Say "often matches," show how sure, and say when to
  see a physio.

## Build order

1. **Anatomy pipeline spike.** Get Z-Anatomy, pick the structure list, rig the
   torso + arms, and export one skinned GLB under budget. Prove the
   across-body reach animates with rhomboids highlighted. This is the risk,
   so it goes first.
2. **Skeleton app.** Vite + Svelte + Threlte + Worker running locally. Layer
   slider works. One exercise plays from JSON.
3. **Pinpoint loop on the golden case.** Red-flag gate + BAML/Jev + assembler
   + catalog components → reproduce the right-shoulder-blade screen.
4. **Fill the regions.** Patterns, exercises and videos for all six regions.
5. **Deploy** to `limber.b28.dev`, then list it on b28.dev.

## Open questions

- Z-Anatomy source size and how clean the per-structure objects are for
  skinning (answered by step 1).
- Spine segmentation for the rig: per-vertebra bones for thoracic rotation?
- Breathing: animate rib expansion? The case study leans on "breathe into it."
- Which physio channels to draw videos from. Credit them.
- Embedding on b28.dev needs the CSP `frame-src` / `frame-ancestors` PATCHes.
