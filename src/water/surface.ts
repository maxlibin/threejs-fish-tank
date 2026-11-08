import {
  Fn, clamp, dot, exp, float, instanceIndex, int, length, mx_noise_float, normalize, normalView, pow, positionViewDirection,
  positionWorld, storage, texture, textureStore, transformNormalToView, uniform, uvec2, vec2, vec3, vec4,
} from 'three/tsl';
import {
  HalfFloatType, LinearFilter, Mesh, MeshPhysicalNodeMaterial, PlaneGeometry, RGBAFormat, StorageBufferAttribute, StorageTexture,
  type ComputeNode, type Node, type WebGPURenderer,
} from 'three/webgpu';
import { FILTER_OUTLET, TANK } from '../tank/dimensions';

export type SurfaceStats = { readonly maxHeight: number; readonly rmsHeight: number; readonly maxSlope: number; readonly rmsSlope: number };

export type WaterSurface = {
  update(dt: number): void;
  largestTimeValue(): number;
  readStats(): Promise<SurfaceStats>;
  mesh: Mesh;
};

const GRID_WIDTH = 900;
const GRID_DEPTH = 294;
const CELLS = GRID_WIDTH * GRID_DEPTH;
const INNER_WIDTH = TANK.width - 2 * TANK.glassThickness;
const INNER_DEPTH = TANK.depth - 2 * TANK.glassThickness;
const CELL_SIZE = INNER_WIDTH / GRID_WIDTH;

const STEP_SECONDS = 1 / 180;
const MAX_STEPS_PER_FRAME = 12;
/** Short gravity-capillary waves travel at roughly this speed. */
const WAVE_SPEED = 0.26;
const VELOCITY_KEEP_PER_STEP = 0.992;
const HEIGHT_KEEP_PER_STEP = 0.9995;
const AMBIENT_FORCING = 0.55;
/** Pulls the surface back to level, which keeps long, slow sloshing from swamping the ripples. */
const LEVELING_PER_SECOND_SQUARED = 40;
const OUTLET_FORCING = 0.7;
const OUTLET_RADIUS = 0.12;
const TIME_WRAP_SECONDS = 2048;

/** Surface state as a texture: r is height in metres, g and b are its x and z slopes. */
const surfaceField = new StorageTexture(GRID_WIDTH, GRID_DEPTH);
surfaceField.type = HalfFloatType;
surfaceField.format = RGBAFormat;
surfaceField.magFilter = LinearFilter;
surfaceField.minFilter = LinearFilter;

const surfaceUv = (worldXZ: Node<'vec2'>): Node<'vec2'> => worldXZ.div(vec2(INNER_WIDTH, INNER_DEPTH)).add(0.5);

/** Height of the water surface above its rest level at a world x, z position. */
export const surfaceHeightNode = (worldXZ: Node<'vec2'>): Node<'float'> => texture(surfaceField, surfaceUv(worldXZ)).r;

/** Slopes of the water surface (dh/dx, dh/dz) at a world x, z position. */
export const surfaceSlopeNode = (worldXZ: Node<'vec2'>): Node<'vec2'> => texture(surfaceField, surfaceUv(worldXZ)).gb;

/** Upward normal of the water surface at a world x, z position. */
export const surfaceNormalNode = (worldXZ: Node<'vec2'>): Node<'vec3'> => {
  const slope = surfaceSlopeNode(worldXZ);
  return normalize(vec3(slope.x.negate(), 1, slope.y.negate()));
};

type WaveCompute = { readonly heightAttribute: StorageBufferAttribute; readonly time: { value: number }; readonly updateVelocity: ComputeNode; readonly updateHeight: ComputeNode; readonly writeField: ComputeNode };

const createWaveCompute = (): WaveCompute => {
  const heightAttribute = new StorageBufferAttribute(new Float32Array(CELLS), 1);
  const heights = storage(heightAttribute, 'float', CELLS);
  const velocities = storage(new StorageBufferAttribute(new Float32Array(CELLS), 1), 'float', CELLS);
  const time = uniform(0);

  const cell = (x: Node<'int'>, y: Node<'int'>): Node<'int'> =>
    clamp(y.toFloat(), 0, GRID_DEPTH - 1).toInt().mul(GRID_WIDTH).add(clamp(x.toFloat(), 0, GRID_WIDTH - 1).toInt());
  const gridX = int(instanceIndex).mod(GRID_WIDTH);
  const gridY = int(instanceIndex).div(GRID_WIDTH);
  const heightAt = (dx: number, dy: number): Node<'float'> => heights.element(cell(gridX.add(dx), gridY.add(dy)));

  const updateVelocity = Fn(() => {
    const laplacian = heightAt(1, 0).add(heightAt(-1, 0)).add(heightAt(0, 1)).add(heightAt(0, -1)).sub(heightAt(0, 0).mul(4)).div(CELL_SIZE * CELL_SIZE);
    const worldX = gridX.toFloat().add(0.5).div(GRID_WIDTH).sub(0.5).mul(INNER_WIDTH);
    const worldZ = gridY.toFloat().add(0.5).div(GRID_DEPTH).sub(0.5).mul(INNER_DEPTH);
    const ripples = mx_noise_float(vec3(worldX.mul(70), worldZ.mul(70), time.mul(5))).add(mx_noise_float(vec3(worldX.mul(30), worldZ.mul(30), time.mul(2.5))).mul(0.6));
    const outletDistance = length(vec2(worldX.sub(FILTER_OUTLET[0]), worldZ.sub(FILTER_OUTLET[2])));
    const outlet = exp(outletDistance.div(OUTLET_RADIUS).pow(2).negate());
    const forcing = ripples.mul(AMBIENT_FORCING).add(mx_noise_float(vec3(worldX.mul(30), worldZ.mul(30), time.mul(5))).mul(outlet).mul(OUTLET_FORCING));
    const next = velocities.element(instanceIndex).add(laplacian.mul(WAVE_SPEED * WAVE_SPEED).sub(heightAt(0, 0).mul(LEVELING_PER_SECOND_SQUARED)).add(forcing).mul(STEP_SECONDS)).mul(VELOCITY_KEEP_PER_STEP);
    velocities.element(instanceIndex).assign(next);
  })().compute(CELLS);

  const updateHeight = Fn(() => {
    heights.element(instanceIndex).assign(heights.element(instanceIndex).add(velocities.element(instanceIndex).mul(STEP_SECONDS)).mul(HEIGHT_KEEP_PER_STEP));
  })().compute(CELLS);

  const writeField = Fn(() => {
    const slopeX = heightAt(1, 0).sub(heightAt(-1, 0)).div(CELL_SIZE * 2);
    const slopeZ = heightAt(0, 1).sub(heightAt(0, -1)).div(CELL_SIZE * 2);
    textureStore(surfaceField, uvec2(gridX.toUint(), gridY.toUint()), vec4(heightAt(0, 0), slopeX, slopeZ, 1)).toWriteOnly();
  })().compute(CELLS);

  return { heightAttribute, time, updateVelocity, updateHeight, writeField };
};

/** The surface seen from above: nearly clear head-on, mirror-like at glancing angles. */
const createSurfaceMesh = (): Mesh => {
  const material = new MeshPhysicalNodeMaterial({ color: 0xffffff, metalness: 0, roughness: 0.03, transparent: true, depthWrite: false });
  const worldXZ = positionWorld.xz;
  material.normalNode = transformNormalToView(surfaceNormalNode(worldXZ));
  const facing = clamp(dot(normalView, positionViewDirection), 0, 1);
  material.opacityNode = float(0.02).add(float(0.98).mul(pow(float(1).sub(facing), 5)));
  const mesh = new Mesh(new PlaneGeometry(INNER_WIDTH, INNER_DEPTH, 1, 1), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, TANK.waterSurfaceY, 0);
  mesh.renderOrder = 1;
  return mesh;
};

const summarizeHeights = (heights: Float32Array): SurfaceStats => {
  const slopeAt = (index: number): number => {
    const x = index % GRID_WIDTH;
    const right = x === GRID_WIDTH - 1 ? index : index + 1;
    const up = index + GRID_WIDTH >= CELLS ? index : index + GRID_WIDTH;
    const here = heights[index] ?? 0;
    return Math.hypot((heights[right] ?? 0) - here, (heights[up] ?? 0) - here) / CELL_SIZE;
  };
  const slopes = Array.from(heights, (_, index) => slopeAt(index));
  const rms = (values: ArrayLike<number>): number => Math.sqrt(Array.from(values).reduce((sum, value) => sum + value * value, 0) / values.length);
  return {
    maxHeight: heights.reduce((largest, height) => Math.max(largest, Math.abs(height)), 0),
    rmsHeight: rms(heights),
    maxSlope: slopes.reduce((largest, slope) => Math.max(largest, slope), 0),
    rmsSlope: rms(slopes),
  };
};

/** Runs a wave simulation on the GPU and exposes the result to everything that looks at the water. */
export const createWaterSurface = (renderer: WebGPURenderer): WaterSurface => {
  const { heightAttribute, time, updateVelocity, updateHeight, writeField } = createWaveCompute();
  let accumulator = 0;
  let elapsed = 0;

  return {
    mesh: createSurfaceMesh(),
    largestTimeValue: () => elapsed,
    readStats: async (): Promise<SurfaceStats> => summarizeHeights(new Float32Array(await renderer.getArrayBufferAsync(heightAttribute))),
    update: (dt: number): void => {
      accumulator = Math.min(accumulator + dt, MAX_STEPS_PER_FRAME * STEP_SECONDS);
      const steps = Math.floor(accumulator / STEP_SECONDS);
      if (steps === 0) return;
      accumulator -= steps * STEP_SECONDS;
      elapsed = (elapsed + steps * STEP_SECONDS) % TIME_WRAP_SECONDS;
      time.value = elapsed;
      for (let step = 0; step < steps; step += 1) {
        void renderer.compute(updateVelocity);
        void renderer.compute(updateHeight);
      }
      void renderer.compute(writeField);
    },
  };
};
