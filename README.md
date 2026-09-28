# Limber

Shows you how to move so it stops hurting.

Most people start with a sore neck or back, search for a video, and hope it's
the right one. Limber starts from where it hurts:

1. **Tap the spot.** A body map for the neck, upper back, low back, shoulder,
   hip and knee.
2. **Answer a few plain questions.** Worse when you sit? Does it run down your
   arm? From that, Limber suggests what's *likely* going on and says how sure
   it is.
3. **Watch the move, and see inside it.** A real human body does each
   exercise, slowly, from any angle. Fade the skin to see the muscles, fade
   those to see the bones. The part that's stretching lights up, with the cue
   that matters ("let the shoulder blade slide away from your spine").
4. **Watch a real person.** Every exercise links one or two hand-picked videos
   from physiotherapists.

Limber is not a doctor. Some answers (numbness in both legs, trouble with your
bladder, pain after a fall, fever) skip everything else and tell you to get
seen first.

Lives at **limber.b28.dev**.

## Start here

You need Node 24 and [just](https://just.systems). To rebuild the body you also
need Blender 5.2 at `/Applications/Blender.app` and the Z-Anatomy files in
`pipeline/source/` (the built body files are already in `public/anatomy/`).

```sh
just install          # JS packages
just dev              # the page at http://localhost:5173
just check            # typecheck + tests (includes posing the real body in Node)
just build            # dist/
just shots            # phone and laptop screenshots of the built page (SHOTS_DIR=… to choose where)

just anatomy          # rebuild the body from Z-Anatomy (~25 s) and copy it into public/anatomy/
```

Handy page options for looking at one moment: `?t=6.6` (seconds into the
move), `?muscles=40` and `?bones=100` (how see-through, in %), `?cam=x,y,z`
(where the camera starts; the body faces +Z, its right side is -X).

**Preview any exercise file.** `?ex=<id>&t=<sec>&cam=<back|front|left|right|34>`
opens any file in `content/exercises/` (listed on the shelf or not) or
`src/app/previews/` at that moment, framed from that side (`34` is the
three-quarter view from behind the right shoulder). For example
`?ex=all-fours-test&t=0&cam=right`. The body is posed and placed by
`src/core/ground.ts`, exactly as the tests check it. `?props=wall-behind,ball`
tries props on a file that lists none. To screenshot: `just build`, then
`node scripts/shots.mjs <outDir> <name-filter>` (add your own line to the
`shots` list; `just shots` takes them all).

The page plays the across-body reach from the first golden case on the whole
skeleton, with the back muscles on both sides.

## How it is put together

| | |
|---|---|
| `src/core/` | Plain TypeScript, no framework. Poses, exercises, the questions, the red-flag check. Fully tested. |
| `src/app/` | Svelte 5 + Threlte. The body map, the questions, the see-through body. |
| `pipeline/` | Turns the Z-Anatomy model into one small, moving body file, using Blender. |
| `content/` | Exercises as data (joint angles over time, cues, breaths), patterns, video links. |
| `baml_src/` | The questions Jev answers about you. |
| `worker/` | Serves the page and `/api/ask`. |

Three rules hold the shape:

**Exercises are data, not animation files.** A move is a list of joint angles
over time. Anyone (or any model) can write one, read one, and test one.

**Jev picks, code builds.** Jev answers typed questions (which pattern, which
muscles to show, which exercises first). Plain code turns the answers into
your screen. Every word on it was written ahead of time.

**Safety runs before the model.** The red-flag check is plain code with its own
tests. Jev never sees answers that should have sent you to a doctor.

**Say how sure you are.** Jev returns probabilities, and the page shows them.
"Probably desk neck" and "definitely desk neck" are different answers.

See `docs/knowledge/plan.md` for the decisions behind this, and
`docs/knowledge/cases/` for the real cases it has to get right.

## Credits

The body comes from [Z-Anatomy](https://github.com/Z-Anatomy) (CC BY-SA 4.0),
which is built on BodyParts3D, © The Database Center for Life Science (CC BY-SA
2.1 Japan). The processed body files in this repo (`public/anatomy/`) carry the
same license, CC BY-SA 4.0; see `public/anatomy/LICENSE-anatomy.txt`. Each GLB
also carries the credit line in its `asset.copyright`. None of Z-Anatomy's
non-commercial parts (inner ear, kidney) are included. The code is MIT.
