import { distanceToNearestSolid, groundHeightAt, type Collider, type GroundGrid } from '../aquascape/colliders';
import { TANK, type Vec3 } from '../tank/dimensions';
import { SPECIES, type SpeciesId } from './species';

/** What each species does. Pure steering calculations; simulation.ts applies them. */

export type FishMode = 'cruise' | 'hover' | 'rest' | 'scatter' | 'surface' | 'root' | 'graze';

export type Steering = { readonly acceleration: Vec3; readonly cruiseSpeed: number };

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: Vec3): Vec3 => {
  const size = length(a);
  return size < 1e-9 ? [1, 0, 0] : scale(a, 1 / size);
};

const INNER_X = TANK.width / 2 - TANK.glassThickness;
const INNER_Z = TANK.frontPaneZ - TANK.glassThickness;

/** The part of the tank a fish may occupy, keeping its body clear of the glass, surface, and substrate. */
export const swimBounds = (species: SpeciesId, x: number, z: number, ground: GroundGrid): { readonly min: Vec3; readonly max: Vec3 } => {
  const margin = SPECIES[species].bodyLength * 0.35;
  return {
    min: [-INNER_X + margin, groundHeightAt(x, z, ground) + margin, -INNER_Z + margin],
    max: [INNER_X - margin, TANK.waterSurfaceY - margin, INNER_Z - margin],
  };
};

/** Pushes back from glass and substrate, more strongly the closer a fish gets. */
export const avoidBounds = (position: Vec3, species: SpeciesId, ground: GroundGrid): Vec3 => {
  const { min, max } = swimBounds(species, position[0], position[2], ground);
  const range = 0.06 + SPECIES[species].bodyLength * 0.6;
  const push = (value: number, low: number, high: number): number => {
    const fromLow = Math.max(0, 1 - (value - low) / range);
    const fromHigh = Math.max(0, 1 - (high - value) / range);
    return fromLow * fromLow - fromHigh * fromHigh;
  };
  return [push(position[0], min[0], max[0]), push(position[1], min[1], max[1]), push(position[2], min[2], max[2])];
};

// The next three run for every fish against every nearby solid at every step, so they rule out distant solids before allocating anything.

/** Steers around rocks, wood, and dense plants before reaching them. */
export const avoidSolids = (position: Vec3, colliders: readonly Collider[], reach: number): Vec3 => {
  let totalX = 0;
  let totalY = 0;
  let totalZ = 0;
  for (const { center, radius } of colliders) {
    const awayX = position[0] - center[0];
    const awayY = position[1] - center[1];
    const awayZ = position[2] - center[2];
    const limit = radius + reach;
    const distanceSquared = awayX * awayX + awayY * awayY + awayZ * awayZ;
    if (distanceSquared > limit * limit) continue;
    const distance = Math.sqrt(distanceSquared);
    const strength = 1 - Math.max(distance - radius, 0) / reach;
    const share = (strength * strength) / Math.max(distance, 1e-9);
    totalX += awayX * share;
    totalY += awayY * share;
    totalZ += awayZ * share;
  }
  return [totalX, totalY, totalZ];
};

/** Moves a point out of any solid it has entered, the last guarantee that no fish passes through one. */
export const pushOutOfSolids = (position: Vec3, colliders: readonly Collider[], clearance: number): Vec3 => {
  let point = position;
  for (const { center, radius } of colliders) {
    const awayX = point[0] - center[0];
    const awayY = point[1] - center[1];
    const awayZ = point[2] - center[2];
    const limit = radius + clearance;
    const distanceSquared = awayX * awayX + awayY * awayY + awayZ * awayZ;
    if (distanceSquared >= limit * limit) continue;
    const distance = Math.sqrt(distanceSquared);
    point = distance < 1e-9 ? [point[0] + limit, point[1], point[2]] : [point[0] + (awayX / distance) * (limit - distance), point[1] + (awayY / distance) * (limit - distance), point[2] + (awayZ / distance) * (limit - distance)];
  }
  return point;
};

/**
 * Slides a point sideways out of any solid. A fish on the bottom cannot be pushed down, so when a
 * rock reaches the ground, sideways is the only way out.
 */
export const slideOutOfSolids = (position: Vec3, colliders: readonly Collider[], clearance: number): Vec3 => {
  let point = position;
  for (const { center, radius } of colliders) {
    const height = point[1] - center[1];
    const reach = radius + clearance;
    if (Math.abs(height) >= reach) continue;
    const needed = Math.sqrt(reach * reach - height * height);
    const awayX = point[0] - center[0];
    const awayZ = point[2] - center[2];
    const across = Math.hypot(awayX, awayZ);
    if (across >= needed) continue;
    point = across < 1e-9 ? [point[0] + needed, point[1], point[2]] : [point[0] + (awayX / across) * (needed - across), point[1], point[2] + (awayZ / across) * (needed - across)];
  }
  return point;
};

/** Whether a point is free of solids; used when choosing somewhere to go. */
export const isOpenWater = (point: Vec3, colliders: readonly Collider[], clearance: number): boolean =>
  distanceToNearestSolid(point, colliders) > clearance;
