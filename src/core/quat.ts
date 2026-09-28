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
