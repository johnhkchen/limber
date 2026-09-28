/** Tiny quaternion helpers, [x, y, z, w], same layout as glTF and three.js. */

export type Quat = readonly [number, number, number, number];
export type Axis = 'x' | 'y' | 'z';
export type Vec3 = readonly [number, number, number];

export const IDENTITY: Quat = [0, 0, 0, 1];

export function fromAxisAngle(axis: Axis, radians: number): Quat {
  const s = Math.sin(radians / 2);
  const c = Math.cos(radians / 2);
  return axis === 'x' ? [s, 0, 0, c] : axis === 'y' ? [0, s, 0, c] : [0, 0, s, c];
}

/** Rotation of `radians` about an arbitrary axis (normalized here). */
export function fromAxisVector(axis: Vec3, radians: number): Quat {
  const n = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  const s = Math.sin(radians / 2) / n;
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(radians / 2)];
}

/** a · b: rotate by b first, then a. */
export function mul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export function conj(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function normalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** Rotate a vector by a unit quaternion. */
export function rotate(q: Quat, v: Vec3): [number, number, number] {
  const r = mul(mul(q, [v[0], v[1], v[2], 0]), conj(q));
  return [r[0], r[1], r[2]];
}

// ---------------------------------------------------------------- vectors and frames

export const add = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const lerp3 = (a: Vec3, b: Vec3, k: number): [number, number, number] => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
export function unit(a: Vec3): [number, number, number] {
  const n = length(a) || 1;
  return [a[0] / n, a[1] / n, a[2] / n];
}

/**
 * Rotation whose columns are the given axes (a bone's local X, Y, Z in world space). The axes are
 * re-orthonormalized around Y first (the pipeline rounds them to 5 decimals).
 */
export function fromBasis(x: Vec3, y: Vec3, _z?: Vec3): Quat {
  const Y = unit(y);
  const X = unit(sub(x, scale(Y, dot(x, Y))));
  const Z = cross(X, Y);
  const [m00, m10, m20] = X;
  const [m01, m11, m21] = Y;
  const [m02, m12, m22] = Z;
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    q = [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    q = [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    q = [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    q = [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
  }
  return normalize(q);
}

/** Angle between two rotations, radians (sign-agnostic; atan2 keeps it precise near zero). */
export function angleBetween(a: Quat, b: Quat): number {
  const r = mul(conj(a), b);
  return 2 * Math.atan2(Math.hypot(r[0], r[1], r[2]), Math.abs(r[3]));
}
