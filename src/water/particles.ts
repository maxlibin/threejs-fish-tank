import { float, fract, instancedBufferAttribute, luminance, normalView, positionGeometry, positionViewDirection, dot, pow, sin, uniform, vec3, bool, smoothstep, clamp } from 'three/tsl';
import { BufferGeometry, IcosahedronGeometry, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, MeshBasicNodeMaterial, type Node } from 'three/webgpu';
import { stochasticThreshold } from '../fish/fishMaterial';
import { TANK, type Vec3 } from '../tank/dimensions';
import { lightTint } from '../tank/lightColours';
import { FLOOR_Y, INNER_X, INNER_Z } from '../tank/portals';
import { applyPortalOptics, insidePortalNode, setObjectMotion } from '../tank/refractionNodes';
import type { Caustics } from './caustics';
import { applySoftWaterLook } from './volume';

/** Seconds of water motion, wrapped so it stays small. Particles and bubbles are functions of it. */
export const waterTime = uniform(0);
export const WATER_TIME_WRAP_SECONDS = 1024;
/** Length of the last frame, for motion vectors. */
export const waterFrameSeconds = uniform(0);

const PARTICLE_COUNT = 3500;
const BUBBLE_COUNT = 11000;
const WATER_HEIGHT = TANK.waterSurfaceY - FLOOR_Y;

/** Repeatable random numbers for instance attributes. */
const seededRandom = (seed: number): (() => number) => {
  const state = { value: seed };
  return () => {
    state.value = (state.value * 1664525 + 1013904223) % 4294967296;
    return state.value / 4294967296;
  };
};

const instancedSphere = (detail: number, attributes: Readonly<Record<string, InstancedBufferAttribute>>, count: number): InstancedBufferGeometry => {
  const source: BufferGeometry = new IcosahedronGeometry(1, detail);
  const geometry = new InstancedBufferGeometry();
  geometry.index = source.index;
  for (const [name, value] of Object.entries(source.attributes)) geometry.setAttribute(name, value as never);
  for (const [name, value] of Object.entries(attributes)) geometry.setAttribute(name, value);
  geometry.instanceCount = count;
  return geometry;
};

/** Fine specks hanging in the water, carried slowly by the current and lit by the same light as everything else. */
export const createParticles = (caustics: Caustics): Mesh => {
  const random = seededRandom(5);
  const seeds = new Float32Array(PARTICLE_COUNT * 4);
  const drifts = new Float32Array(PARTICLE_COUNT * 4);
  for (let index = 0; index < PARTICLE_COUNT; index += 1) {
    seeds.set([random(), random(), random(), 0.00018 + random() ** 3 * 0.00045], index * 4);
    drifts.set([(random() - 0.3) * 0.0016, (random() - 0.55) * 0.0007, (random() - 0.5) * 0.0013, random() * 6.28], index * 4);
  }
  const seedAttribute = new InstancedBufferAttribute(seeds, 4);
  const driftAttribute = new InstancedBufferAttribute(drifts, 4);
  const seed = instancedBufferAttribute(seedAttribute) as unknown as Node<'vec4'>;
  const drift = instancedBufferAttribute(driftAttribute) as unknown as Node<'vec4'>;
  const wander = sin(waterTime.mul(0.23).add(drift.w)).mul(0.012);
  const place = fract(seed.xyz.add(drift.xyz.mul(waterTime)));
  const center = vec3(
    place.x.sub(0.5).mul(INNER_X * 2).add(wander),
    place.y.mul(WATER_HEIGHT).add(FLOOR_Y),
    place.z.sub(0.5).mul(INNER_Z * 2).add(wander.mul(0.6)),
  );
  const material = applySoftWaterLook(applyPortalOptics(new MeshBasicNodeMaterial()));
  material.positionNode = positionGeometry.mul(seed.w).add(center);
  material.colorNode = vec3(0.62, 0.66, 0.6).mul(luminance(caustics.causticsAtNode(center)).mul(0.5).add(0.25)).mul(lightTint);
  material.maskNode = bool(insidePortalNode).and(stochasticThreshold.lessThan(0.62));
  const mesh = new Mesh(instancedSphere(0, { seedAttribute, driftAttribute }, PARTICLE_COUNT), material);
  mesh.frustumCulled = false;
  return mesh;
};

/** Air bubbles rising from a hidden stone, spreading into a curtain, each a clear shell with a bright rim. */
export const createBubbles = (airStone: Vec3): Mesh => {
  const random = seededRandom(9);
  const seeds = new Float32Array(BUBBLE_COUNT * 4);
  const shapes = new Float32Array(BUBBLE_COUNT * 4);
  for (let index = 0; index < BUBBLE_COUNT; index += 1) {
    // Mostly fine fizz, with only the odd larger bubble.
    const size = 0.0005 + random() ** 4.5 * 0.0034;
    seeds.set([random(), (random() - 0.5) * 2, (random() - 0.5) * 2, size], index * 4);
    // Bigger bubbles rise faster.
    shapes.set([0.13 + size * 55 + random() * 0.05, random() * 6.28, 2 + random() * 3, random()], index * 4);
  }
  const seedAttribute = new InstancedBufferAttribute(seeds, 4);
  const shapeAttribute = new InstancedBufferAttribute(shapes, 4);
  const seed = instancedBufferAttribute(seedAttribute) as unknown as Node<'vec4'>;
  const shape = instancedBufferAttribute(shapeAttribute) as unknown as Node<'vec4'>;
  const riseHeight = float(TANK.waterSurfaceY - airStone[1]);
  const risen = fract(seed.x.add(waterTime.mul(shape.x).div(riseHeight)));
  const spread = risen.pow(0.7);
  const wobble = sin(waterTime.mul(shape.z).add(shape.y)).mul(0.0035).mul(spread.add(0.2));
  const center = vec3(
    seed.y.mul(spread).mul(0.3).add(wobble).add(airStone[0]).add(spread.mul(0.02)),
    risen.mul(riseHeight).add(airStone[1]),
    seed.z.mul(spread).mul(0.08).add(wobble.mul(0.7)).add(airStone[2]).add(spread.mul(0.03)),
  );
  const material = applySoftWaterLook(applyPortalOptics(new MeshBasicNodeMaterial()));
  // Slightly flattened, like real rising bubbles.
  material.positionNode = positionGeometry.mul(vec3(1, 0.86, 1)).mul(seed.w).add(center);
  const facing = clamp(dot(normalView, positionViewDirection).abs(), 0, 1);
  const rim = pow(float(1).sub(facing), float(2.6));
  const highlight = pow(clamp(dot(normalView, vec3(0.3, 0.75, 0.59)), 0, 1), float(26));
  // Bright where light catches the shell's edge and top; the middle of a bubble is clear.
  material.colorNode = vec3(0.92, 1, 1).mul(rim.mul(2.4)).add(vec3(1).mul(highlight.mul(5))).add(vec3(1.25, 1.42, 1.46)).mul(lightTint);
  const opacity = rim.add(highlight).add(0.72);
  const nearSurface = smoothstep(0.985, 1, risen).oneMinus();
  material.maskNode = bool(insidePortalNode).and(stochasticThreshold.lessThan(opacity.mul(nearSurface)));
  // Bubbles rise fast, so the temporal resolve needs to know where they came from.
  setObjectMotion(material, vec3(0, shape.x.mul(waterFrameSeconds), 0));
  const mesh = new Mesh(instancedSphere(0, { seedAttribute, shapeAttribute }, BUBBLE_COUNT), material);
  mesh.frustumCulled = false;
  return mesh;
};
