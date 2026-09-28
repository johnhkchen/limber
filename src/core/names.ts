/** Plain names for structures, for people. Z-Anatomy names stay in data; these go on screen. */

const PLAIN: Record<string, string> = {
  'Rhomboid major muscle': 'Rhomboid (big)',
  'Rhomboid minor muscle': 'Rhomboid (small)',
  'Costotransverse ligament': 'Rib-to-spine joint',
  'Levator scapulae': 'Shoulder-blade lifter',
  'Serratus anterior muscle': 'Side-of-ribs muscle',
  'External intercostal muscles': 'Between-the-ribs muscles',
  'Internal intercostal muscles': 'Between-the-ribs muscles (inner)',
  // Z-Anatomy swaps these two labels (pipeline/data/name-fixups.json): the object called
  // "Descending part" is the lower fibres, "Ascending part" the neck fibres. Keyed by za_name.
  'Descending part of trapezius muscle': 'Lower trapezius',
  'Transverse part of trapezius muscle': 'Middle trapezius',
  'Ascending part of trapezius muscle': 'Upper trapezius',
  'Latissimus dorsi muscle': 'Lats',
};

/** `Rhomboid major muscle.r` → `{ name: 'Rhomboid (big)', side: 'right' }`. */
export function plainName(zaName: string): { name: string; side: 'left' | 'right' | null } {
  const m = /^(.*)\.(l|r)$/.exec(zaName);
  const base = m ? m[1]! : zaName;
  const side = m ? (m[2] === 'l' ? 'left' : 'right') : null;
  return { name: PLAIN[base] ?? base.replace(/ muscles?$/, ''), side };
}
