import { Fn, Loop, attribute, exp, float, int, length, mix, normalize, positionGeometry, renderGroup, sin, smoothstep, uniform, uniformArray, vec3 } from 'three/tsl';
import { Vector4, type Node } from 'three/webgpu';
import { FILTER_OUTLET } from '../tank/dimensions';
import { MAX_PLANT_BUMPS, type PlantBump } from './plantBumps';

/** Slow motion of the water, in radians, wrapped so it never grows. */
export const plantPhase = uniform(0);

const OUTLET = vec3(FILTER_OUTLET[0], FILTER_OUTLET[1], FILTER_OUTLET[2]);
const SWAY_METRES = 0.024;
const BUMP_REACH_METRES = 0.2;
const BUMP_METRES = 0.055;
const BUMP_DAMPING = 2.2;
const BUMP_RADIANS_PER_SECOND = 11;

const bumpPlaces = Array.from({ length: MAX_PLANT_BUMPS }, () => new Vector4());
const bumpDirections = Array.from({ length: MAX_PLANT_BUMPS }, () => new Vector4());
const bumpPlaceNodes = uniformArray(bumpPlaces, 'vec4').setGroup(renderGroup);
const bumpDirectionNodes = uniformArray(bumpDirections, 'vec4').setGroup(renderGroup);

/** Hands the current shakes to the shader. xyz is where or which way; w is strength or age. */
export const setPlantBumps = (bumps: readonly PlantBump[]): void => {
  bumpPlaces.forEach((place, index) => {
    const bump = bumps[index];
    place.set(bump?.position[0] ?? 0, bump?.position[1] ?? 0, bump?.position[2] ?? 0, bump?.strength ?? 0);
    bumpDirections[index]?.set(bump?.direction[0] ?? 0, bump?.direction[1] ?? 0, bump?.direction[2] ?? 0, bump?.ageSeconds ?? 0);
  });
};

/** Leaves near a passing fish are pushed along its path, then spring back and forth until they settle. */
const plantBumpNode = Fn(([weight]: [Node<'float'>]) => {
  const total = vec3(0, 0, 0).toVar();
  Loop(int(MAX_PLANT_BUMPS), ({ i }: { i: Node<'int'> }) => {
    const place = bumpPlaceNodes.element(i) as unknown as Node<'vec4'>;
    const direction = bumpDirectionNodes.element(i) as unknown as Node<'vec4'>;
    const near = smoothstep(float(BUMP_REACH_METRES), float(0), length(positionGeometry.sub(place.xyz)));
    const spring = exp(direction.w.mul(BUMP_DAMPING).negate()).mul(sin(direction.w.mul(BUMP_RADIANS_PER_SECOND).add(1.2)));
    total.addAssign(direction.xyz.mul(place.w).mul(near).mul(spring));
  });
  return total.mul(weight).mul(BUMP_METRES);
});

/** A smooth flow field: water pushed away from the filter outlet, weakening across the tank. */
export const currentAtNode = (worldPosition: Node<'vec3'>): Node<'vec3'> => {
  const fromOutlet = worldPosition.sub(OUTLET);
  return normalize(fromOutlet).mul(mix(float(0.4), float(1), exp(length(fromOutlet).div(0.45).negate())));
};

/** Plants lean with the current and sway in it, more toward their tips, each plant in its own time. */
export const plantSwayNode = (): Node<'vec3'> => {
  const masks = attribute('color', 'vec4') as unknown as Node<'vec4'>;
  const weight = masks.r.mul(masks.r.sqrt());
  const phase = masks.g.mul(Math.PI * 2);
  const place = positionGeometry.x.mul(5).add(positionGeometry.z.mul(7));
  const sway = float(0.55).add(sin(plantPhase.add(phase).add(place)).mul(0.65)).add(sin(plantPhase.mul(3).add(phase.mul(2)).add(positionGeometry.y.mul(16))).mul(0.14));
  return positionGeometry.add(currentAtNode(positionGeometry).mul(sway).mul(weight).mul(SWAY_METRES)).add(plantBumpNode(masks.r));
};
