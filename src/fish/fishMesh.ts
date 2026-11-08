import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedBufferGeometry, Mesh, NoColorSpace, SRGBColorSpace, TextureLoader,
  type Texture, type Object3D,
} from 'three/webgpu';
import { createFishBodyMaterial, createFishEyeMaterial, type FishMaps } from './fishMaterial';
import type { FishState } from './simulation';
import { createSwimNodes, type FishInstanceAttributes } from './swimNodes';
import { SPECIES, type SpeciesId } from './species';

export class AssetLoadError extends Error {
  override name = 'AssetLoadError';
}

export type LoadedFishAsset = {
  readonly body: BufferGeometry;
  readonly eye: BufferGeometry;
  readonly maps: FishMaps;
};

export type FishMesh = {
  update(fish: readonly FishState[], frameSeconds: number): void;
  readonly object: Object3D;
};

const ANISOTROPY = 16;
/** The shadow of a smaller fish cannot be made out on the sand, and every fish is another shadow draw. */
const SMALLEST_FISH_WITH_SHADOW = 0.1;

const loadMap = async (url: string, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): Promise<Texture> => {
  const texture = await new TextureLoader().loadAsync(url).catch((cause: unknown) => {
    throw new AssetLoadError(`Could not load the texture ${url}: ${String(cause)}. Rebuild it with tools/blender.`);
  });
  texture.flipY = false;
  texture.colorSpace = colorSpace;
  texture.anisotropy = ANISOTROPY;
  return texture;
};

const requireGeometry = (root: Object3D, name: string, url: string): BufferGeometry => {
  const found = root.getObjectByName(name);
  if (!(found instanceof Mesh)) throw new AssetLoadError(`${url} has no mesh named "${name}". Rebuild it with tools/blender.`);
  return found.geometry as BufferGeometry;
};

/** Loads a fish's geometry and its folder of maps. */
export const loadFishAsset = async (name: string): Promise<LoadedFishAsset> => {
  const url = `${import.meta.env.BASE_URL}assets/fish/${name}.glb`;
  const response = await fetch(url);
  if (!response.ok) throw new AssetLoadError(`Could not load ${url}: HTTP ${response.status}. Rebuild it with tools/blender.`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const [baseColor, normal, material, eye] = await Promise.all([
    loadMap(`${import.meta.env.BASE_URL}assets/fish/${name}/baseColor.png`, SRGBColorSpace),
    loadMap(`${import.meta.env.BASE_URL}assets/fish/${name}/normal.png`, NoColorSpace),
    loadMap(`${import.meta.env.BASE_URL}assets/fish/${name}/material.png`, NoColorSpace),
    loadMap(`${import.meta.env.BASE_URL}assets/fish/${name}/eye.png`, SRGBColorSpace),
  ]);
  return {
    body: requireGeometry(gltf.scene, 'body', url),
    eye: requireGeometry(gltf.scene, 'eye', url),
    maps: { baseColor, normal, material, eye },
  };
};

const createInstanceAttributes = (count: number): FishInstanceAttributes => {
  const make = (size: number): InstancedBufferAttribute => new InstancedBufferAttribute(new Float32Array(count * size), size).setUsage(DynamicDrawUsage);
  return { placement: make(4), rotation: make(4), swim: make(4), motion: make(3) };
};

const instanced = (geometry: BufferGeometry, count: number): InstancedBufferGeometry => {
  const result = new InstancedBufferGeometry();
  result.index = geometry.index;
  for (const [name, attribute] of Object.entries(geometry.attributes)) result.setAttribute(name, attribute as BufferAttribute);
  result.instanceCount = count;
  return result;
};

/** Quaternion turning +x onto `heading` while keeping the back up. */
const headingQuaternion = ([hx, hy, hz]: readonly [number, number, number]): readonly [number, number, number, number] => {
  const yaw = Math.atan2(-hz, hx);
  const pitch = Math.atan2(hy, Math.hypot(hx, hz));
  const [cy, sy, cp, sp] = [Math.cos(yaw / 2), Math.sin(yaw / 2), Math.cos(pitch / 2), Math.sin(pitch / 2)];
  return [-sy * sp, sy * cp, cy * sp, cy * cp];
};

/** Draws every fish of one species. All per-fish state lives in instance attributes, so nothing is shared or looped. */
export const createFishMesh = (asset: LoadedFishAsset, species: SpeciesId, count: number): FishMesh => {
  const attributes = createInstanceAttributes(count);
  const swim = createSwimNodes(attributes, SPECIES[species]);
  const body = new Mesh(instanced(asset.body, count), createFishBodyMaterial(asset.maps, swim));
  const eye = new Mesh(instanced(asset.eye, count), createFishEyeMaterial(asset.maps, swim));
  for (const part of [body, eye]) {
    part.castShadow = SPECIES[species].bodyLength >= SMALLEST_FISH_WITH_SHADOW;
    part.receiveShadow = true;
    part.frustumCulled = false;
  }
  const object = new Group();
  object.add(body, eye);
  const previous = new Float32Array(count * 3);
  let hasPrevious = false;

  return {
    object,
    update: (fish: readonly FishState[], frameSeconds: number): void => {
      if (fish.length !== count) throw new Error(`createFishMesh was made for ${count} ${species}, but got ${fish.length}.`);
      fish.forEach((state, index) => {
        const [x, y, z] = state.position;
        // Tempo doubles as a small difference in size, so no two fish match.
        attributes.placement.setXYZW(index, x, y, z, 0.86 + (state.tempo - 0.82) * 0.75);
        const [qx, qy, qz, qw] = headingQuaternion(state.heading);
        attributes.rotation.setXYZW(index, qx, qy, qz, qw);
        attributes.swim.setXYZW(index, state.swimPhase, state.swimAmplitude, state.turnCurvature, state.finSpread);
        const moved = hasPrevious && frameSeconds > 0;
        attributes.motion.setXYZ(index, moved ? x - (previous[index * 3] ?? x) : 0, moved ? y - (previous[index * 3 + 1] ?? y) : 0, moved ? z - (previous[index * 3 + 2] ?? z) : 0);
        previous.set(state.position, index * 3);
      });
      hasPrevious = true;
      for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
    },
  };
};
