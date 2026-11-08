import type { Vec3 } from '../tank/dimensions';

/** Leaves disturbed by a passing fish. Pure bookkeeping here; plantNodes.ts moves the leaves. */

export type PlantBump = { readonly position: Vec3; readonly direction: Vec3; readonly strength: number; readonly ageSeconds: number };
export type SwimmingFish = { readonly position: Vec3; readonly velocity: Vec3 };
export type LeafCells = ReadonlySet<number>;

export const MAX_PLANT_BUMPS = 12;
export const BUMP_SECONDS = 2.2;
const CELL_METRES = 0.05;
const MIN_SPEED = 0.025;
const FULL_STRENGTH_SPEED = 0.16;
/** A fish still in the same leaves does not start another shake until the first has faded a little. */
const SAME_LEAVES_METRES = 0.14;
const SAME_LEAVES_SECONDS = 0.9;

const cellKey = (column: number, row: number, layer: number): number => (column + 512) * 1048576 + (row + 512) * 1024 + (layer + 512);
const cellOf = (value: number): number => Math.floor(value / CELL_METRES);

/** Marks the cells around every leaf point, so a fish touches leaves slightly before it reaches them. */
export const createLeafCells = (points: readonly Vec3[]): LeafCells => {
  const cells = new Set<number>();
  for (const [x, y, z] of points) {
    for (let column = -1; column <= 1; column += 1) {
      for (let row = -1; row <= 1; row += 1) {
        for (let layer = -1; layer <= 1; layer += 1) cells.add(cellKey(cellOf(x) + column, cellOf(y) + row, cellOf(z) + layer));
      }
    }
  }
  return cells;
};

const isAmongLeaves = ([x, y, z]: Vec3, cells: LeafCells): boolean => cells.has(cellKey(cellOf(x), cellOf(y), cellOf(z)));

const isAlreadyShaking = ([x, y, z]: Vec3, bumps: readonly PlantBump[]): boolean =>
  bumps.some(({ position, ageSeconds }) => ageSeconds < SAME_LEAVES_SECONDS && Math.hypot(position[0] - x, position[1] - y, position[2] - z) < SAME_LEAVES_METRES);

/** Ages the current shakes, and starts new ones where fish are pushing through leaves, while there is room. A shake under way always finishes, so that leaves never snap back. */
export const updatePlantBumps = (bumps: readonly PlantBump[], fish: readonly SwimmingFish[], cells: LeafCells, seconds: number): readonly PlantBump[] => {
  const aged = bumps.map((bump): PlantBump => ({ ...bump, ageSeconds: bump.ageSeconds + seconds })).filter((bump) => bump.ageSeconds < BUMP_SECONDS);
  return fish.reduce<readonly PlantBump[]>((current, { position, velocity }) => {
    const speed = Math.hypot(velocity[0], velocity[1], velocity[2]);
    if (current.length >= MAX_PLANT_BUMPS || speed < MIN_SPEED || !isAmongLeaves(position, cells) || isAlreadyShaking(position, current)) return current;
    const direction: Vec3 = [velocity[0] / speed, velocity[1] / speed, velocity[2] / speed];
    return [...current, { position, direction, strength: Math.min(1, speed / FULL_STRENGTH_SPEED), ageSeconds: 0 }];
  }, aged);
};

/** Validates plant_points.json, which tools/blender/build_aquascape.py writes. */
export const parsePlantPoints = (json: unknown): readonly Vec3[] => {
  if (!Array.isArray(json) || json.length === 0) throw new Error('plant_points.json needs a list of leaf points. Rebuild it with tools/blender/build_aquascape.py.');
  const isPoint = (value: unknown): value is Vec3 => Array.isArray(value) && value.length === 3 && value.every((part) => typeof part === 'number');
  if (!json.every(isPoint)) throw new Error('plant_points.json has an entry that is not three numbers. Rebuild it with tools/blender/build_aquascape.py.');
  return json;
};
