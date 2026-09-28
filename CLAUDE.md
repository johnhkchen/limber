# Limber — agent guide

Read `README.md` then `docs/knowledge/plan.md`. Those are the decisions.

- `src/core/` must not import Svelte, Threlte, or three.js. Pose math, the
  exercise schema, questions, and the red-flag gate live here with tests.
- The red-flag gate runs before any model call. Don't route around it.
- User-facing copy follows the b28 brand voice: plain kitchen-table English,
  never "diagnosis." Say "often matches" and show how sure.
- Secrets come from Doppler `blanksy-tenants/prd_b28`. The Worker reaches Jev
  through the Cloudflare `AI` binding (see `~/swe/repos/tech-explorer/docs/jev-access.md`).
