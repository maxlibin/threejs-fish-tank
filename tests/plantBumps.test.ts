import { expect, test } from 'vitest';
import { MAX_PLANT_BUMPS, createLeafCells, updatePlantBumps, type PlantBump, type SwimmingFish } from '../src/aquascape/plantBumps';
import type { Vec3 } from '../src/tank/dimensions';

const LEAF: Vec3 = [0.5, 1, 0];
const cells = createLeafCells([LEAF]);
const swimmer = (position: Vec3, speed: number): SwimmingFish => ({ position, velocity: [speed, 0, 0] });

test('a fish swimming into leaves sets them shaking', () => {
  const bumps = updatePlantBumps([], [swimmer(LEAF, 0.1)], cells, 0.01);
  expect(bumps).toHaveLength(1);
  expect(bumps[0]?.strength).toBeGreaterThan(0);
});

test('a fish in open water disturbs nothing', () => {
  expect(updatePlantBumps([], [swimmer([-1, 1.5, 0.2], 0.1)], cells, 0.01)).toHaveLength(0);
});

test('a resting fish among leaves does not shake them', () => {
  expect(updatePlantBumps([], [swimmer(LEAF, 0.005)], cells, 0.01)).toHaveLength(0);
});

test('one fish passing through makes one shake, not one every frame', () => {
  const after = Array.from({ length: 20 }).reduce<readonly PlantBump[]>((bumps) => updatePlantBumps(bumps, [swimmer(LEAF, 0.1)], cells, 0.01), []);
  expect(after).toHaveLength(1);
});

test('the shaking dies away', () => {
  const started = updatePlantBumps([], [swimmer(LEAF, 0.1)], cells, 0.01);
  const later = Array.from({ length: 400 }).reduce<readonly PlantBump[]>((bumps) => updatePlantBumps(bumps, [], cells, 0.01), started);
  expect(later).toHaveLength(0);
});

test('never more shakes at once than the shader can draw', () => {
  const crowd = Array.from({ length: 60 }, (_, index): Vec3 => [index * 0.3, 1, 0]);
  const everywhere = createLeafCells(crowd);
  const bumps = updatePlantBumps([], crowd.map((position) => swimmer(position, 0.2)), everywhere, 0.01);
  expect(bumps.length).toBe(MAX_PLANT_BUMPS);
});

test('a shake under way is not pushed out by newer ones', () => {
  const crowd = Array.from({ length: 60 }, (_, index): Vec3 => [index * 0.3, 1, 0]);
  const everywhere = createLeafCells(crowd);
  const first = updatePlantBumps([], [swimmer([0, 1, 0], 0.2)], everywhere, 0.01);
  const later = updatePlantBumps(first, crowd.map((position) => swimmer(position, 0.2)), everywhere, 0.01);
  expect(later[0]?.position).toEqual([0, 1, 0]);
});

test('the input is not changed', () => {
  const start: readonly PlantBump[] = updatePlantBumps([], [swimmer(LEAF, 0.1)], cells, 0.01);
  const copy = JSON.stringify(start);
  updatePlantBumps(start, [swimmer([1, 1, 0], 0.1)], cells, 0.5);
  expect(JSON.stringify(start)).toBe(copy);
});
