import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attribute, bool, float, luminance, mix, normalMap, smoothstep, texture, vec3 } from 'three/tsl';
import { Mesh, MeshStandardNodeMaterial, NoColorSpace, SRGBColorSpace, TextureLoader, type Node, type Texture } from 'three/webgpu';
import { stochasticThreshold } from '../fish/fishMaterial';
import { applyPortalOptics, insidePortalNode, portalUniforms } from '../tank/refractionNodes';
import { applySoftWaterLook } from '../water/volume';
import { plantSwayNode } from './plantNodes';

const loadAtlas = async (url: string, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): Promise<Texture> => {
  const map = await new TextureLoader().loadAsync(url).catch((cause: unknown) => {
    throw new Error(`Could not load the leaf atlas ${url}: ${String(cause)}. Rebuild it with tools/blender/build_aquascape.py.`);
  });
  map.flipY = false;
  map.colorSpace = colorSpace;
  map.anisotropy = 16;
  return map;
};

/** Leaves pass light through, so they glow where the tank light is behind them. */
const createLeafMaterial = async (): Promise<MeshStandardNodeMaterial> => {
  const [baseColor, normal, surface] = await Promise.all([
    loadAtlas('/assets/aquascape/leaves/baseColor.png', SRGBColorSpace),
    loadAtlas('/assets/aquascape/leaves/normal.png', NoColorSpace),
    loadAtlas('/assets/aquascape/leaves/material.png', NoColorSpace),
  ]);
  const material = applySoftWaterLook(applyPortalOptics(new MeshStandardNodeMaterial({ metalness: 0 })));
  const masks = attribute('color', 'vec4') as unknown as Node<'vec4'>;
  const base = texture(baseColor);
  const variation = mix(vec3(1.14, 1.02, 0.7), vec3(0.92, 1.0, 0.92), masks.b);
  // Dark where leaves crowd near their bases, which gives the mass of a plant depth.
  const crowding = mix(float(0.5), float(1.08), masks.a.mul(masks.r.add(0.45)).clamp(0, 1));
  // Young growth at the tips of leaves is lighter and yellower.
  const tips = vec3(1.2, 1.2, 0.95).mul(masks.a.mul(masks.a).mul(masks.a)).add(vec3(1).mul(masks.a.mul(masks.a).mul(masks.a).oneMinus()));
  const green = base.rgb.mul(variation).mul(crowding).mul(tips);
  // The top of the colour-variation range marks red-bronze plants.
  const bronze = vec3(luminance(base.rgb).mul(2.1), luminance(base.rgb).mul(0.62), luminance(base.rgb).mul(0.42)).mul(crowding);
  const color = mix(green, bronze, smoothstep(0.92, 0.97, masks.b));
  const sway = plantSwayNode();
  material.positionNode = sway;
  material.castShadowPositionNode = sway;
  material.colorNode = color;
  material.roughnessNode = texture(surface).r;
  material.normalNode = normalMap(texture(normal).xyz).mul(portalUniforms.normalSign);
  material.emissiveNode = color.mul(0.14);
  const holes = base.a.greaterThan(stochasticThreshold.mul(0.5).add(0.25));
  material.maskNode = bool(insidePortalNode).and(holes);
  return material;
};

/** Loads every plant in the tank as one mesh; each leaf was grown individually. */
export const loadPlants = async (): Promise<Mesh> => {
  const url = '/assets/aquascape/plants.glb';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}. Rebuild it with tools/blender/build_aquascape.py.`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const found = gltf.scene.getObjectByName('plants');
  if (!(found instanceof Mesh)) throw new Error(`${url} has no mesh named "plants". Rebuild it with tools/blender/build_aquascape.py.`);
  const plants = new Mesh(found.geometry, await createLeafMaterial());
  plants.castShadow = true;
  plants.receiveShadow = true;
  return plants;
};
