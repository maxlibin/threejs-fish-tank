import type { Plane3, Vec3 } from './dimensions';

/** Fixed Newton iteration count, shared with the shader version in refractionNodes.ts. */
export const NEWTON_ITERATIONS = 6;

const MIN_DEPTH = 1e-6;

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

/**
 * Finds where the light path from a point in water to an eye in air crosses a flat interface,
 * by solving Snell's law with Newton's method in the plane holding eye, point, and normal.
 * The plane's normal points toward the eye.
 */
export const solveRefractionCrossing = (eye: Vec3, point: Vec3, plane: Plane3, iorRatio: number): Vec3 => {
  const eyeHeight = dot(plane.normal, eye) + plane.constant;
  const pointDepth = Math.max(-(dot(plane.normal, point) + plane.constant), MIN_DEPTH);
  const eyeFoot = sub(eye, scale(plane.normal, eyeHeight));
  const pointFoot = add(point, scale(plane.normal, pointDepth));
  const lateral = sub(pointFoot, eyeFoot);
  const separation = length(lateral);
  if (separation === 0) return eyeFoot;

  const newtonStep = (x: number): number => {
    const rest = separation - x;
    const airSquared = x * x + eyeHeight * eyeHeight;
    const waterSquared = rest * rest + pointDepth * pointDepth;
    const residual = x / Math.sqrt(airSquared) - (iorRatio * rest) / Math.sqrt(waterSquared);
    const slope =
      (eyeHeight * eyeHeight) / (airSquared * Math.sqrt(airSquared)) +
      (iorRatio * pointDepth * pointDepth) / (waterSquared * Math.sqrt(waterSquared));
    return Math.min(separation, Math.max(0, x - residual / slope));
  };

  const start = (separation * eyeHeight) / (eyeHeight + iorRatio * pointDepth);
  const solved = Array.from({ length: NEWTON_ITERATIONS }).reduce<number>((x) => newtonStep(x), start);
  return add(eyeFoot, scale(lateral, solved / separation));
};

/**
 * Where a submerged point appears to the eye: along the eye-to-crossing ray, at the distance that
 * keeps depth order, which gives the familiar shortening of depth by the refractive index.
 */
export const apparentPosition = (eye: Vec3, point: Vec3, plane: Plane3, iorRatio: number): Vec3 => {
  const crossing = solveRefractionCrossing(eye, point, plane, iorRatio);
  const ray = sub(crossing, eye);
  return add(crossing, scale(ray, length(sub(crossing, point)) / iorRatio / length(ray)));
};
