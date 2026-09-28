# Plan — decisions from the kickoff (2026-09-28)

## What it is

A self-help helper for common aches, in three parts:

1. **Figure** — an animated clay mannequin showing each exercise.
2. **Pinpoint** — body map + questions → likely patterns, with probabilities.
3. **Videos** — hand-picked links per exercise.

## Decisions

| Topic | Decision | Why |
|---|---|---|
| Name | **Limber** → `limber.b28.dev`, `github.com/johnhkchen/limber` (public) | Warm, grab-able. |
| Figure | Procedural **clay mannequin** in three.js: rounded primitives, a simple joint hierarchy. Exercises are JSON keyframes of joint angles + cues. | Model-authorable and testable, no asset licensing, fits b28 claymorphism. |
| Figure lib | **Threlte** (Svelte wrapper for three.js) | DX. Keep the pose math in `src/core/` so it doesn't depend on Threlte. |
| Pinpoint | **Body map + questions, plus Jev follow-up.** Deterministic red-flag gate runs first. Jev (via Cloudflare AI binding `typesafe/jev`, same as Magpie) picks a follow-up question and scores patterns. | Jev's Choice answers carry probabilities → an honest "how sure" display. |
| Videos | **Hand-picked** list in `content/`. A link checker runs in CI. | Quality over coverage. No API keys. |
| Scope v1 | **Neck, back, shoulder, hip, knee** (~25 exercises) | Broad from day one. |
| Stack | Svelte 5 + Vite + Threlte front end. Hono Worker on Cloudflare (static assets + `/api/ask`, rate-limited like Magpie's `ASKS`). | Same family as Mahjong/Magpie. |
| Process | Built directly in session, no vend/lisa board. | |
| Look | b28 clay palette (steel `#44679b`, off-white `#faf8f5`, Lora/Karla). | Brand family. |

## Safety notes

- Not medical advice. Say so plainly, without scary legal walls.
- Red flags (cauda equina signs, trauma, fever/weight loss, progressive
  weakness, chest pain with arm pain, etc.) short-circuit to "get seen."
- Never output a diagnosis. Output *patterns that often match*, with
  probability and a "see a physio if…" line.

## Open questions

- Exact Jev question schema (Choice over patterns vs. per-pattern Score).
- Mannequin rig: how many joints (spine as 3–5 segments?) and IK for hands/feet
  on the floor/wall.
- Which physio channels to draw videos from; licensing of embeds is fine
  (YouTube embed), but credit them.
- Embedding on b28.dev needs the CSP `frame-src` / `frame-ancestors` rule
  PATCHes (see the tortoise-vs-hare deploy notes).
