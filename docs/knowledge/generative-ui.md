# Generative UI in Limber

_As of 2026-09-28. Adapted from the general decision-driven generative UI brief._

## The idea in one line

Jev decides **what** goes on your screen. Plain code decides **how** it's built.
Claude writes every component and every word at build time. Jev answers typed
questions at runtime, and the answers become the screen.

## Why it fits Limber

A physio answer is already a set of choices from a fixed shelf: which pattern
this probably is, which structures to show, which exercises in which order,
what to avoid, when to get seen. The case study in
`cases/right-shoulder-blade.md` is exactly that. Every section of it is one
catalog component, filled in with choices.

## The loop

```
body map tap + answers ──► red-flag gate (plain code, tested)
                              │ any red flag → "get seen" screen. Jev is never asked.
                              ▼
                        BAML → Jev (one batched call)
                              │ Choice / Score / Noul, with probabilities
                              ▼
                        spec assembler (plain code)
                              │
                              ▼
                        renderer (Svelte catalog + Threlte anatomy)
                              │ "that one helped" / "that brought the catch back"
                              └──► back into the state, re-ask only the affected part
```

## Catalog (first cut, taken from the case study)

| Component | Case study section | Filled by |
|---|---|---|
| `AnatomyFocus` | Background | Jev picks structures to highlight + layer + camera |
| `WhyItHurts` | Background / why a crunch provokes it | authored text per pattern |
| `PossibleCauses` | Differential table | Jev scores each pattern's fit; red-flag causes shown as "ruled out because…" |
| `AvoidForNow` | Avoid for now | authored per pattern, Jev picks which apply |
| `GeneralRelief` | General relief | authored, Jev picks |
| `ExerciseRoutine` | Exercises | Jev picks and orders from the pattern's exercise set; each plays on the anatomy |
| `ExpectedCourse` | Expected course | authored per pattern |
| `WatchFor` | Red flags | authored per region, always shown |
| `SeeSomeone` | Red flag hit | shown instead of everything else |

## What Jev decides (first cut)

| Question | Type | Options | Drives |
|---|---|---|---|
| `pattern` | Choice | per-region pattern ids + `none_fit` | Which pattern template the assembler uses |
| `pattern_fit` (per pattern) | Score | poor, some, good, strong | The "possible causes" table and the "how sure" display |
| `highlight` (per structure) | Noul | yes/no probability | Which muscles/joints glow on the anatomy |
| `layer` | Choice | skin, muscle, deep_muscle, skeleton | Which layer is opaque by default |
| `exercise_fit` (per exercise) | Score | skip, maybe, good, best | Routine order; `skip` drops it |
| `avoid_applies` (per item) | Noul | yes/no probability | Avoid list contents |

Every Choice has `none_fit`. Thresholds live in TypeScript, not in the questions.

## Rules we're holding to

- **Native BAML nightly, `typesafeai` client.** No hand-built transport, no
  SDK wrapper "in case." Add a workaround only when a real failure shows up.
- **No runtime generative LLM in v1.** Every word is written at build time.
  `none_fit` or low confidence → the plain body-area browse screen, and the
  gap is logged. The log is the backlog for the next build.
- **The red-flag gate is not a Jev question.** It's code with tests.
- **X-ray view is a feature.** A toggle shows Jev's answers and probabilities,
  then the assembled spec, beside the screen. That's the demo, and it's also
  the honesty.
