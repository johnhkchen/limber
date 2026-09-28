/**
 * Limber Worker (stub). Serves the built page from `dist/` through the ASSETS binding and
 * reserves `/api/ask` for the Pinpoint loop (red-flag gate first, then Jev via the AI binding).
 * Not wired up yet: build-order step 3.
 */

interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/ask') {
      return Response.json({ error: 'not yet' }, { status: 501 });
    }
    return env.ASSETS.fetch(req);
  },
};
