/**
 * The setlist: the case's five moves, which of them have a moving body yet, and what you said about each.
 * View-side glue (no three.js). Pure pieces are exported for tests.
 */
import { parseExercise, type Exercise, type Prop, type SetupName } from '../core/exercise';
import setlistJson from './setlist.json';

export type SetlistJson = typeof setlistJson;
export type SetlistEntry = SetlistJson['exercises'][number];
export const setlist: SetlistJson = setlistJson;

// ---------------------------------------------------------------- exercises on disk

/**
 * Every file in content/exercises/ becomes an exercise; new files show up on the shelf by themselves.
 * A file that doesn't pass the contract is left out (and logged) instead of taking the page down.
 */
export function loadExercises(files: Record<string, unknown>): { exercises: Exercise[]; broken: string[] } {
  const exercises: Exercise[] = [];
  const broken: string[] = [];
  for (const [path, json] of Object.entries(files)) {
    try {
      exercises.push(parseExercise(json));
    } catch (e) {
      broken.push(path);
      console.warn(`[limber] skipped ${path}: ${(e as Error).message}`);
    }
  }
  return { exercises, broken };
}

export interface ShelfItem {
  entry: SetlistEntry;
  /** The moving body for this one, if its file exists yet. */
  exercise: Exercise | null;
}

/** Setlist order, matched to files by id. Files that aren't on the setlist aren't shown here. */
export function shelf(entries: readonly SetlistEntry[], exercises: readonly Exercise[]): ShelfItem[] {
  return entries.map((entry) => ({ entry, exercise: exercises.find((e) => e.id === entry.id) ?? null }));
}

// ---------------------------------------------------------------- optional fields

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const SETUP_WORDS: Record<SetupName, string> = {
  standing: 'Stand up tall.',
  sitting: 'Sit on a chair.',
  kneeling: 'Kneel on the floor.',
  allFours: 'Get on your hands and knees.',
  sideLyingLeft: 'Lie on your left side.',
  sideLyingRight: 'Lie on your right side.',
  againstWall: 'Stand with your back to a wall.',
};

/** "Get set" words for the starting position, if the file names one (standing needs no words). */
export function setupWords(ex: Exercise): string | null {
  const s = ex.setup?.start;
  return s && s !== 'standing' ? SETUP_WORDS[s] : null;
}

/** Dev preview of props on any move: `?props=floor,mat,doorframe-left,wall-behind`. */
export function propsFromParam(param: string | null): Prop[] {
  if (!param) return [];
  const out: Prop[] = [];
  for (const s of param.split(',')) {
    const [kind, arg] = s.split('-');
    if (kind === 'floor') out.push({ kind });
    else if (kind === 'mat') out.push({ kind });
    else if (kind === 'doorframe') out.push({ kind, side: arg === 'right' ? 'right' : 'left' });
    else if (kind === 'wall') out.push({ kind, side: (['behind', 'front', 'left', 'right'] as const).find((w) => w === arg) ?? 'behind' });
    else if (kind === 'ball') out.push({ kind, at: 'back.r' });
  }
  return out;
}

export type View = 'back' | 'front' | 'left' | 'right' | 'back-right' | 'back-left' | 'front-right' | 'front-left' | 'top-front';

/**
 * Which way to look at the body. The camera then backs off until the whole pose fits.
 * TODO(core): exercises don't carry `camera` yet; the setlist entry's hint is used meanwhile. If core
 * adds it, keep this shape (view, elevation, fit, zoom) or map to it here.
 */
export interface CameraHint {
  view: View;
  /** Degrees above level. */
  elevation: number;
  /** `body` fits the whole posed body; `highlight` fits what lights up. */
  fit: 'body' | 'highlight';
  /** >1 closer, <1 further. */
  zoom: number;
}

const VIEWS: Record<View, [number, number]> = {
  // [x, z] direction from the body to the camera. The body faces +Z; its right is -X.
  back: [0, -1],
  front: [0, 1],
  left: [1, 0],
  right: [-1, 0],
  'back-right': [-0.72, -0.7],
  'back-left': [0.72, -0.7],
  'front-right': [-0.7, 0.72],
  'front-left': [0.7, 0.72],
  'top-front': [-0.25, 1],
};

/** The file's `camera` wins, then the setlist's, then a look from behind the right shoulder. */
export function cameraHint(...sources: unknown[]): CameraHint {
  const h: CameraHint = { view: 'back-right', elevation: 18, fit: 'body', zoom: 1 };
  for (const s of [...sources].reverse()) {
    if (!isObj(s)) continue;
    if (typeof s.view === 'string' && s.view in VIEWS) h.view = s.view as View;
    if (isNum(s.elevation)) h.elevation = s.elevation;
    if (s.fit === 'body' || s.fit === 'highlight') h.fit = s.fit;
    if (isNum(s.zoom) && s.zoom > 0) h.zoom = s.zoom;
  }
  return h;
}

/** Unit vector from the target toward the camera. */
export function viewDirection(h: CameraHint): [number, number, number] {
  const [x, z] = VIEWS[h.view];
  const len = Math.hypot(x, z);
  const el = (h.elevation * Math.PI) / 180;
  return [(x / len) * Math.cos(el), Math.sin(el), (z / len) * Math.cos(el)];
}

// ---------------------------------------------------------------- what you said (localStorage)

export type Feel = 'helped' | 'fine' | 'catch';
export type BreathResult = 'better' | 'same' | 'worse';

export interface Notes {
  /** Per exercise id: the last thing you said about it. `catch` means skip it for now. */
  feel: Record<string, { feel: Feel; at: number }>;
  /** Each round's deep-breath check, newest last. */
  checks: { result: BreathResult; at: number }[];
}

const KEY = 'limber.notes.v1';
const empty = (): Notes => ({ feel: {}, checks: [] });

export function readNotes(storage: Pick<Storage, 'getItem'> | undefined = globalThis.localStorage): Notes {
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return empty();
    const j: unknown = JSON.parse(raw);
    if (!isObj(j)) return empty();
    const feel: Notes['feel'] = {};
    if (isObj(j.feel))
      for (const [id, v] of Object.entries(j.feel))
        if (isObj(v) && (v.feel === 'helped' || v.feel === 'fine' || v.feel === 'catch')) feel[id] = { feel: v.feel, at: isNum(v.at) ? v.at : 0 };
    const checks = Array.isArray(j.checks)
      ? j.checks.filter((c): c is Notes['checks'][number] => isObj(c) && ['better', 'same', 'worse'].includes(c.result as string)).slice(-50)
      : [];
    return { feel, checks };
  } catch {
    return empty();
  }
}

export function writeNotes(n: Notes, storage: Pick<Storage, 'setItem'> | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(KEY, JSON.stringify(n));
  } catch {
    /* private window or storage off: the page still works, it just won't remember */
  }
}

export function setFeel(n: Notes, id: string, feel: Feel | null, at = Date.now()): Notes {
  const next = { ...n.feel };
  if (feel) next[id] = { feel, at };
  else delete next[id];
  return { ...n, feel: next };
}

export const isSkipped = (n: Notes, id: string) => n.feel[id]?.feel === 'catch';

export const FEEL_LABEL: Record<Feel, string> = {
  helped: 'Helped',
  fine: 'Fine',
  catch: 'Brought the catch back',
};
