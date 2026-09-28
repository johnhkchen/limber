# Limber — agent guide

Read `README.md` then `docs/knowledge/plan.md`. Those are the decisions.

- Also read `docs/knowledge/generative-ui.md`. Jev decides, code assembles,
  and there's no runtime generative LLM in v1.
- BAML: native nightly with the `typesafeai` client. No premature fallbacks,
  SDK wrappers, or hand-rolled transports. Add one only for an observed failure.
- `src/core/` must not import Svelte, Threlte, or three.js. Pose math, the
  exercise schema, questions, and the red-flag gate live here with tests.
- The red-flag gate runs before any model call. Don't route around it.
- User-facing copy follows the b28 brand voice: plain kitchen-table English,
  never "diagnosis." Say "often matches" and show how sure.
- Anatomy assets are CC BY-SA 4.0 (Z-Anatomy/BodyParts3D). Never pull in the
  NC-licensed parts (inner ear, kidney) or the nqwrc export.
- `docs/knowledge/cases/*.md` are golden cases. The app must reproduce them.
- Secrets come from Doppler `blanksy-tenants/prd_b28`. The Worker reaches Jev
  through the Cloudflare `AI` binding (see `~/swe/repos/tech-explorer/docs/jev-access.md`).
