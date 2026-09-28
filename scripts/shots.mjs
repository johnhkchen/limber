// Screenshots of the built page at phone and laptop size.
// Usage: node scripts/shots.mjs [outDir] [only]   (`only` keeps shots whose name contains it, e.g. `full-34`)
// Serves dist/ with `vite preview`, opens headless Chromium (WebGL via SwiftShader), and saves PNGs.
// Each shot waits for what it shows: the posed body (`window.__limber`) or a piece of the page.
import { chromium } from 'playwright';
import { preview } from 'vite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = process.argv[2] ?? process.env.SHOTS_DIR ?? 'shots';
const only = process.argv[3] ?? process.env.SHOTS_ONLY ?? '';
mkdirSync(out, { recursive: true });

const server = await preview({ preview: { port: 4179, strictPort: true } });
const base = 'http://localhost:4179/';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// The golden case (across-body reach) at phone size: REST, mid-reach, full reach during the hold,
// from behind and from a 3/4 view behind the right shoulder, plus one from the front-right.
// Body faces +Z, the subject's right is -X, so "behind" is -Z.
const BACK = 'cam=-0.03,1.35,-1.45';
const THREE_Q = 'cam=-1.05,1.5,-1.1';
const FRONT = 'cam=-0.25,1.45,1.8';
const RSIDE = 'cam=-1.5,1.35,0.1';
const P = { w: 390, h: 844, mobile: true };
const shots = [
  { name: 'rest-back', q: `?t=0&muscles=40&${BACK}`, ...P },
  { name: 'rest-34', q: `?t=0&muscles=40&${THREE_Q}`, ...P },
  { name: 'mid-back', q: `?t=1.8&muscles=40&${BACK}`, ...P },
  { name: 'mid-34', q: `?t=1.8&muscles=40&${THREE_Q}`, ...P },
  { name: 'full-back', q: `?t=6.6&muscles=40&${BACK}`, ...P },
  { name: 'full-34', q: `?t=6.6&muscles=40&${THREE_Q}`, ...P },
  { name: 'full-front', q: `?t=6.6&muscles=40&${FRONT}`, ...P },
  { name: 'rest-front', q: `?t=0&muscles=40&${FRONT}`, ...P },
  { name: 'full-rside', q: `?t=6.6&muscles=40&${RSIDE}`, ...P },
  { name: 'full-default', q: `?t=6.6`, ...P },
  { name: 'full-neck', q: `?t=6.6&cam=-0.5,1.5,-0.5`, ...P },
  { name: 'full-34-deep', q: `?t=6.6&muscles=100&bones=100&${THREE_Q}`, ...P },
  { name: 'full-page', q: `?t=6.6&muscles=40`, ...P, full: true },
  { name: 'laptop-full', q: `?t=6.6&muscles=40`, w: 1280, h: 800, mobile: false },
  // Named cameras (?cam=back|front|left|right|34 frame the whole body from that side).
  { name: 'full-named-34', q: `?ex=across-body-reach&t=6.6&cam=34`, ...P },
  // The page around the body: the shelf, one move, the round, the breath check.
  { name: 'setlist', q: ``, ...P, full: true, wait: '.shelf' },
  { name: 'player', q: `?ex=across-body-reach&t=6.6`, ...P, full: true },
  { name: 'round-1', q: `?round=1&t=6.6`, ...P },
  { name: 'breath-check', q: `?round=check`, ...P, full: true, wait: '#check-title' },
  { name: 'laptop-setlist', q: ``, w: 1280, h: 800, mobile: false, wait: '.shelf' },
  // Preview any exercise file (src/app/previews/ or content/exercises/) at a moment, from a side.
  { name: 'allfours-right', q: `?ex=all-fours-test&t=0&cam=right&muscles=40`, ...P },
  { name: 'allfours-34', q: `?ex=all-fours-test&t=0&cam=34&muscles=40`, ...P },
].filter((s) => s.name.includes(only));

let failed = false;
for (const s of shots) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: s.mobile ? 2 : 1, isMobile: s.mobile, hasTouch: s.mobile });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const t0 = Date.now();
  await page.goto(base + s.q);
  if (s.wait) await page.waitForSelector(s.wait, { timeout: 30000 }).catch(() => errors.push(`never saw ${s.wait}`));
  else await page.waitForFunction(() => window.__limber, null, { timeout: 30000 }).catch(() => errors.push('never ready'));
  const info = await page.evaluate(() => window.__limber ?? null);
  await page.waitForTimeout(800);
  const file = join(out, `${s.name}-${s.w}x${s.h}.png`);
  await page.screenshot({ path: file, fullPage: !!s.full });
  console.log(`SHOT ${file} ready=${Date.now() - t0}ms info=${JSON.stringify(info)} errors=${JSON.stringify(errors)}`);
  if (errors.length) failed = true;
  await ctx.close();
}
await browser.close();
server.httpServer.close();
process.exit(failed ? 1 : 0);
