import type { Vec3 } from '../tank/dimensions';

export class InvalidColliderFileError extends Error {
  override name = 'InvalidColliderFileError';
}

export type Collider = { readonly center: Vec3; readonly radius: number };

/** Substrate height on a regular grid, row by row from the back left. */
export type GroundGrid = {
  readonly minX: number;
  readonly minZ: number;
  readonly stepX: number;
  readonly stepZ: number;
  readonly columns: number;
  readonly rows: number;
  readonly heights: readonly number[];
};

export type ColliderFile = { readonly colliders: readonly Collider[]; readonly hardscapeSamples: readonly Vec3[]; readonly ground: GroundGrid };

const isVec3 = (value: unknown): value is Vec3 =>
  Array.isArray(value) && value.length === 3 && value.every((component) => typeof component === 'number');

/** Validates colliders.json, which tools/blender/build_aquascape.py writes. */
export const parseColliders = (json: object): ColliderFile => {
  const { colliders, hardscapeSamples, ground } = json as { colliders?: unknown; hardscapeSamples?: unknown; ground?: GroundGrid };
  if (!Array.isArray(colliders) || !Array.isArray(hardscapeSamples) || ground === undefined || !Array.isArray(ground.heights)) {
    throw new InvalidColliderFileError('colliders.json needs "colliders", "hardscapeSamples", and "ground". Rebuild it with tools/blender/build_aquascape.py.');
  }
  colliders.forEach((collider: { center?: unknown; radius?: unknown }, index) => {
    if (!isVec3(collider.center) || typeof collider.radius !== 'number') {
      throw new InvalidColliderFileError(`colliders.json entry ${index} needs a 3-number "center" and a numeric "radius"; got ${JSON.stringify(collider)}.`);
    }
  });
  if (!hardscapeSamples.every(isVec3)) throw new InvalidColliderFileError('colliders.json has a hardscape sample that is not three numbers.');
  return { colliders: colliders as readonly Collider[], hardscapeSamples: hardscapeSamples as readonly Vec3[], ground };
};

/** Signed distance from a point to the nearest solid; negative or zero means inside one. */
export const distanceToNearestSolid = ([x, y, z]: Vec3, colliders: readonly Collider[]): number =>
  colliders.reduce((nearest, { center, radius }) => Math.min(nearest, Math.hypot(x - center[0], y - center[1], z - center[2]) - radius), Number.POSITIVE_INFINITY);

/** Substrate height at a point, interpolated between grid samples. */
export const groundHeightAt = (x: number, z: number, ground: GroundGrid): number => {
  const column = Math.min(Math.max((x - ground.minX) / ground.stepX, 0), ground.columns - 1.001);
  const row = Math.min(Math.max((z - ground.minZ) / ground.stepZ, 0), ground.rows - 1.001);
  const c = Math.floor(column);
  const r = Math.floor(row);
  const at = (rowIndex: number, columnIndex: number): number => ground.heights[rowIndex * ground.columns + columnIndex] ?? 0;
  const near = at(r, c) + (at(r, c + 1) - at(r, c)) * (column - c);
  const far = at(r + 1, c) + (at(r + 1, c + 1) - at(r + 1, c)) * (column - c);
  return near + (far - near) * (row - r);
};
