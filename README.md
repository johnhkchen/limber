# Limber

Shows you how to move so it stops hurting.

Most people start with a sore neck or back, search for a video, and hope it's
the right one. Limber starts from where it hurts:

1. **Tap the spot.** A body map for the neck, back, shoulder, hip and knee.
2. **Answer a few plain questions.** Worse when you sit? Does it run down your
   arm? From that, Limber suggests what's *likely* going on and says how sure
   it is.
3. **Watch the move.** A clay figure does each exercise slowly, from any angle,
   with the cue that matters ("glide your chin straight back").
4. **Watch a real person.** Every exercise links one or two hand-picked videos
   from physiotherapists.

Limber is not a doctor. Some answers (numbness in both legs, trouble with your
bladder, pain after a fall, fever) skip everything else and tell you to get
seen first.

Lives at **limber.b28.dev**.

## How it is put together

| | |
|---|---|
| `src/core/` | Plain TypeScript, no framework. Poses, exercises, the questions, the red-flag check. Fully tested. |
| `src/app/` | Svelte 5 + Threlte. The body map, the questions, the clay figure. |
| `content/` | Exercises as data: joint angles over time, cues, video links. |
| `worker/` | Serves the page and `/api/ask`, which asks Jev follow-up questions. |

Three rules hold the shape:

**Exercises are data, not animation files.** A move is a list of joint angles
over time. Anyone (or any model) can write one, read one, and test one.

**Safety runs before the model.** The red-flag check is plain code with its own
tests. Jev never sees answers that should have sent you to a doctor.

**Say how sure you are.** Jev returns probabilities, and the page shows them.
"Probably desk neck" and "definitely desk neck" are different answers.

See `docs/knowledge/plan.md` for the decisions behind this.
