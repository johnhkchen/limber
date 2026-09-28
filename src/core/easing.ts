/** Easing curves for keyframe stretches. Input and output are 0..1. */

export const EASINGS = ['linear', 'in', 'out', 'inOut', 'step'] as const;
export type Easing = (typeof EASINGS)[number];

export function ease(kind: Easing, x: number): number {
  const u = Math.min(Math.max(x, 0), 1);
  switch (kind) {
    case 'linear':
      return u;
    case 'in':
      return 1 - Math.cos((u * Math.PI) / 2);
    case 'out':
      return Math.sin((u * Math.PI) / 2);
    case 'inOut':
      return (1 - Math.cos(u * Math.PI)) / 2;
    case 'step':
      return u < 1 ? 0 : 1;
  }
}
