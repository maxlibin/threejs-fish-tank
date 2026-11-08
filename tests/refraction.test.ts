import { describe, expect, test } from 'vitest';
import { apparentPosition, solveRefractionCrossing } from '../src/tank/refraction';
import type { Plane3, Vec3 } from '../src/tank/dimensions';

const FRONT_PANE: Plane3 = { normal: [0, 0, 1], constant: 0 };
const WATER = 1.333;

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const length = (a: Vec3): number => Math.hypot(...a);
/** Sine of the angle between a ray and the +z pane normal. */
const sineFromNormal = (ray: Vec3): number => Math.hypot(ray[0], ray[1]) / length(ray);

describe('solveRefractionCrossing', () => {
  test('head-on ray crosses straight through', () => {
    expect(solveRefractionCrossing([0.2, 1, 1], [0.2, 1, -0.3], FRONT_PANE, WATER)).toEqual([0.2, 1, 0]);
  });

  test('with no index change the crossing lies on the straight line', () => {
    const crossing = solveRefractionCrossing([0, 0, 1], [1, 0, -1], FRONT_PANE, 1);
    expect(crossing[0]).toBeCloseTo(0.5, 6);
  });

  // Incidence angle in air runs from a few degrees to about 75 degrees.
  test.each<[Vec3, Vec3]>([
    [[0.1, 1, 0.5], [0, 1, -0.3]],
    [[0.5, 1.2, 0.3], [-0.2, 0.9, -0.1]],
    [[1, 1, 0.25], [0.5, 1, -0.45]],
    [[2.5, 1.4, 0.6], [-0.6, 0.8, -0.45]],
    [[3, 1, 0.8], [0.6, 1, -0.02]],
  ])('crossing obeys Snell law at the pane for eye %j', (eye, point) => {
    const crossing = solveRefractionCrossing(eye, point, FRONT_PANE, WATER);
    expect(crossing[2]).toBe(0);
    const sinIncident = sineFromNormal(sub(eye, crossing));
    const sinRefracted = sineFromNormal(sub(crossing, point));
    expect(sinIncident / sinRefracted).toBeCloseTo(1.333, 3);
    const optical = (at: Vec3): number => length(sub(eye, at)) + WATER * length(sub(at, point));
    const h = 1e-5;
    const direction = sub(crossing, eye);
    const unit = Math.hypot(direction[0], direction[1]);
    const along: Vec3 = [(direction[0] / unit) * h, (direction[1] / unit) * h, 0];
    const pathDerivativeAtCrossing =
      (optical([crossing[0] + along[0], crossing[1] + along[1], 0]) -
        optical([crossing[0] - along[0], crossing[1] - along[1], 0])) /
      (2 * h);
    expect(pathDerivativeAtCrossing).toBeCloseTo(0, 3);
  });
});

describe('apparentPosition', () => {
  test('a point seen head-on appears at depth divided by the index', () => {
    const apparent = apparentPosition([0, 1, 1], [0, 1, -0.4], FRONT_PANE, WATER);
    expect(apparent[2]).toBeCloseTo(-0.4 / 1.333, 6);
    expect(apparent[0]).toBeCloseTo(0, 6);
  });

  test('a point on the pane stays where it is', () => {
    const apparent = apparentPosition([0.4, 1.1, 0.6], [0.1, 0.9, 0], FRONT_PANE, WATER);
    expect(apparent[0]).toBeCloseTo(0.1, 5);
    expect(apparent[1]).toBeCloseTo(0.9, 5);
    expect(apparent[2]).toBeCloseTo(0, 5);
  });
});
