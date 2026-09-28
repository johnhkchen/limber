/**
 * "Do the round": step through the moves, then check with a deep breath.
 *
 * TODO(core): src/core/routine.ts is getting a routine reducer. When it lands, make `step()` a thin
 * adapter over it (or delete this file) — the components only use `startRound`, `step` and `current`.
 */
export interface Round {
  /** The moves in this round, in order. Ones marked "brought the catch back" are left out. */
  ids: string[];
  /** Ones left out because they brought the catch back. */
  skipped: string[];
  /** Index into `ids` while stage is `moves`. */
  at: number;
  stage: 'moves' | 'check';
}

export type RoundAction = { type: 'next' } | { type: 'back' } | { type: 'goto'; at: number };

export function startRound(ids: readonly string[], skip: (id: string) => boolean): Round {
  const keep = ids.filter((id) => !skip(id));
  return { ids: keep, skipped: ids.filter(skip), at: 0, stage: keep.length ? 'moves' : 'check' };
}

export function step(r: Round, a: RoundAction): Round {
  switch (a.type) {
    case 'next':
      if (r.stage === 'check') return r;
      return r.at + 1 >= r.ids.length ? { ...r, stage: 'check' } : { ...r, at: r.at + 1 };
    case 'back':
      if (r.stage === 'check') return r.ids.length ? { ...r, stage: 'moves', at: r.ids.length - 1 } : r;
      return { ...r, at: Math.max(0, r.at - 1) };
    case 'goto':
      return r.ids.length ? { ...r, stage: 'moves', at: Math.min(Math.max(0, a.at), r.ids.length - 1) } : r;
  }
}

export const current = (r: Round): string | null => (r.stage === 'moves' ? r.ids[r.at] ?? null : null);
