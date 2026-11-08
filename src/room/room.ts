import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Fn, cameraPosition, clamp, float, luminance, mix, normalMap, pow, positionWorld, reflect, smoothstep, texture, uv, vec2, vec3 } from 'three/tsl';
import {
  EquirectangularReflectionMapping, HalfFloatType, LinearFilter, Mesh, MeshStandardNodeMaterial, NoColorSpace, PMREMGenerator, RepeatWrapping, SRGBColorSpace,
  Box3, Scene, TextureLoader, type Group, type Node, type Texture, type WebGPURenderer,
} from 'three/webgpu';
import { TANK } from '../tank/dimensions';
import { TUNED_WHITE, lightTint } from '../tank/lightColours';

export type Room = {
  /** Drawn before the tank: walls, floor, and ceiling, which are never in front of the water. */
  readonly behind: Scene;
  /** Drawn after the tank: everything that can pass in front of it, such as the sofa. */
  readonly front: Scene;
  readonly environment: Texture;
  /** Where the light switch on the left wall is, for clicks to find it. */
  readonly switchBounds: Box3;
};

type SurfaceSpec = {
  readonly folder: string | null;
  readonly tilesPerMetre: number;
  /** Colour multiplied in. With `greyTexture`, the texture supplies only light and dark. */
  readonly tint: readonly [number, number, number];
  readonly greyTexture: boolean;
  readonly roughness: number;
  readonly metalness: number;
  /** Turns the texture a quarter turn, for wood whose grain must run upward. */
  readonly grainAlongV: boolean;
  /** How strongly a grey texture's light and dark show; low values keep painted walls even. */
  readonly textureContrast: number;
};

const SURFACES: Readonly<Record<string, SurfaceSpec>> = {
  behind_floor: { folder: 'floor', tilesPerMetre: 0.55, tint: [0.56, 0.55, 0.52], greyTexture: true, roughness: 0.75, metalness: 0, grainAlongV: false, textureContrast: 0.9 },
  behind_wall: { folder: 'wall', tilesPerMetre: 0.8, tint: [0.27, 0.275, 0.26], greyTexture: true, roughness: 0.82, metalness: 0, grainAlongV: false, textureContrast: 0.18 },
  behind_ceiling: { folder: 'ceiling', tilesPerMetre: 0.6, tint: [0.92, 0.88, 0.8], greyTexture: true, roughness: 0.95, metalness: 0, grainAlongV: false, textureContrast: 0.2 },
  behind_panel: { folder: 'panel', tilesPerMetre: 0.9, tint: [0.2, 0.17, 0.145], greyTexture: true, roughness: 0.68, metalness: 0, grainAlongV: true, textureContrast: 0.9 },
  front_cabinet: { folder: null, tilesPerMetre: 1, tint: [0.4, 0.37, 0.33], greyTexture: false, roughness: 0.48, metalness: 0, grainAlongV: false, textureContrast: 1 },
  front_black: { folder: null, tilesPerMetre: 1, tint: [0.018, 0.018, 0.018], greyTexture: false, roughness: 0.42, metalness: 0, grainAlongV: false, textureContrast: 1 },
  front_gloss: { folder: null, tilesPerMetre: 1, tint: [0.012, 0.012, 0.014], greyTexture: false, roughness: 0.07, metalness: 0, grainAlongV: false, textureContrast: 1 },
  front_metal: { folder: null, tilesPerMetre: 1, tint: [0.6, 0.6, 0.58], greyTexture: false, roughness: 0.32, metalness: 1, grainAlongV: false, textureContrast: 1 },
  front_fabric: { folder: 'fabric', tilesPerMetre: 5.5, tint: [0.68, 0.68, 0.7], greyTexture: true, roughness: 0.97, metalness: 0, grainAlongV: false, textureContrast: 0.8 },
  front_curtain: { folder: 'curtain', tilesPerMetre: 4, tint: [0.2, 0.2, 0.17], greyTexture: true, roughness: 0.96, metalness: 0, grainAlongV: false, textureContrast: 0.8 },
  front_speaker: { folder: 'curtain', tilesPerMetre: 9, tint: [0.035, 0.035, 0.035], greyTexture: true, roughness: 0.9, metalness: 0, grainAlongV: false, textureContrast: 0.8 },
  front_switch: { folder: null, tilesPerMetre: 1, tint: [0.78, 0.77, 0.74], greyTexture: false, roughness: 0.35, metalness: 0, grainAlongV: false, textureContrast: 1 },
};

/** Keeps the room dim, so that the tank is by far the brightest thing in it. */
const ROOM_LIGHT = 0.95;
const ROOM_LIGHT_COLOUR = 0.42;
const LED_BRIGHTNESS = 5;
const LED_BAR_BRIGHTNESS = 9;
const SCREEN_BRIGHTNESS = 0.5;
const SWITCH_INDICATOR_BRIGHTNESS = 3;
const FLOOR_REFLECTION = 0.42;
const FRESNEL_FLOOR_F0 = 0.05;

const loadMap = async (url: string, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): Promise<Texture> => {
  const map = await new TextureLoader().loadAsync(url).catch((cause: unknown) => {
    throw new Error(`Could not load the room texture ${url}: ${String(cause)}.`);
  });
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.colorSpace = colorSpace;
  map.anisotropy = 16;
  return map;
};

/** EXR rows run the opposite way to glTF's V coordinate. */
const lightFromMap = (lightmap: Texture): Node<'vec3'> => {
  const light = texture(lightmap, vec2(uv(1).x, float(1).sub(uv(1).y))).rgb;
  // The bake came out warmer than the photo; this pulls it back toward neutral.
  return mix(vec3(luminance(light)), light, ROOM_LIGHT_COLOUR).mul(ROOM_LIGHT);
};

/** The room's baked light: all of it, and the tank's share alone, which follows the tank light's colour. */
type BakedLight = { readonly all: Texture; readonly tankOnly: Texture };

const bakedLight = (lightmaps: BakedLight): Node<'vec3'> =>
  lightFromMap(lightmaps.all).add(lightFromMap(lightmaps.tankOnly).mul(lightTint.sub(1))).max(0);

/**
 * The surface's diffuse look comes from baked light multiplied by albedo, so it holds real shadows and
 * bounce light. Its colour is black so reflections of the room are all three.js adds on top.
 */
const createBakedMaterial = async (spec: SurfaceSpec, lightmaps: BakedLight, extraLight: Node<'vec3'> | null): Promise<MeshStandardNodeMaterial> => {
  const material = new MeshStandardNodeMaterial({ metalness: spec.metalness, roughness: spec.roughness, color: spec.metalness > 0 ? 0xffffff : 0x000000 });
  const baked = bakedLight(lightmaps);
  const tint = vec3(spec.tint[0], spec.tint[1], spec.tint[2]);
  if (spec.folder === null) {
    if (spec.metalness > 0) material.colorNode = tint;
    material.emissiveNode = baked.mul(tint);
    return material;
  }
  const [albedoMap, normalTexture, roughnessMap] = await Promise.all([
    loadMap(`${import.meta.env.BASE_URL}assets/room/${spec.folder}/diffuse.jpg`, SRGBColorSpace),
    loadMap(`${import.meta.env.BASE_URL}assets/room/${spec.folder}/normal.jpg`, NoColorSpace),
    loadMap(`${import.meta.env.BASE_URL}assets/room/${spec.folder}/rough.jpg`, NoColorSpace),
  ]);
  const tiled = (spec.grainAlongV ? uv().yx : uv()).mul(spec.tilesPerMetre);
  const sampled = texture(albedoMap, tiled).rgb;
  const grey = mix(float(1), luminance(sampled).div(0.5).clamp(0.3, 1.6), spec.textureContrast);
  const albedo = spec.greyTexture ? tint.mul(grey) : sampled.mul(tint);
  const normalSample = texture(normalTexture, tiled).xyz;
  // Baked light cannot see fine surface detail, so that shading is added back here.
  const detail = mix(float(0.72), float(1.06), normalSample.z.mul(normalSample.z));
  material.normalNode = normalMap(normalSample);
  material.roughnessNode = texture(roughnessMap, tiled).r.mul(spec.roughness + 0.1).clamp(0.05, 1);
  const lit = baked.mul(albedo).mul(detail);
  material.emissiveNode = extraLight === null ? lit : lit.add(extraLight);
  return material;
};

/** What the floor mirrors of the tank: the view reflected off the floor, traced to the front glass. */
const tankOnFloor = (tankImage: Texture): Node<'vec3'> =>
  Fn(() => {
    const toFloor = positionWorld.sub(cameraPosition).normalize();
    const reflected = reflect(toFloor, vec3(0, 1, 0));
    const steps = float(TANK.frontPaneZ).sub(positionWorld.z).div(reflected.z);
    const hit = positionWorld.add(reflected.mul(steps));
    const across = hit.x.div(TANK.width).add(0.5);
    const up = hit.y.sub(TANK.standTopY).div(TANK.height);
    const inside = smoothstep(-0.03, 0.03, across).mul(smoothstep(1.03, 0.97, across)).mul(smoothstep(-0.03, 0.03, up)).mul(smoothstep(1.03, 0.97, up));
    const lookingBack = reflected.z.lessThan(0).select(float(1), float(0));
    // Farther from the glass, the wood's roughness blurs the reflection more.
    const blur = positionWorld.z.sub(TANK.frontPaneZ).mul(2).add(4).clamp(4, 7.5);
    const fresnel = float(FRESNEL_FLOOR_F0).add(float(1 - FRESNEL_FLOOR_F0).mul(pow(float(1).sub(clamp(reflected.y, 0, 1)), 5)));
    return texture(tankImage, vec2(across, up)).level(blur).rgb.mul(lightTint).mul(inside).mul(lookingBack).mul(fresnel).mul(FLOOR_REFLECTION);
  })();

const loadEquirectangular = async (renderer: WebGPURenderer): Promise<Texture> => {
  const url = `${import.meta.env.BASE_URL}assets/room/reflection.exr`;
  const map = await new EXRLoader().setDataType(HalfFloatType).loadAsync(url).catch((cause: unknown) => {
    throw new Error(`Could not load ${url}: ${String(cause)}. Rebuild it with tools/blender/build_room.py.`);
  });
  map.mapping = EquirectangularReflectionMapping;
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromEquirectangular(map);
  generator.dispose();
  return target.texture;
};

/** Loads the room, its baked light, and its reflections. */
export const loadRoom = async (renderer: WebGPURenderer): Promise<Room> => {
  const url = `${import.meta.env.BASE_URL}assets/room/room.glb`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}. Rebuild it with tools/blender/build_room.py.`);
  const [gltf, lightmap, tankLightmap, environment, tankImage] = await Promise.all([
    new GLTFLoader().parseAsync(await response.arrayBuffer(), ''),
    new EXRLoader().setDataType(HalfFloatType).loadAsync(`${import.meta.env.BASE_URL}assets/room/lightmap.exr`),
    new EXRLoader().setDataType(HalfFloatType).loadAsync(`${import.meta.env.BASE_URL}assets/room/tank_light.exr`),
    loadEquirectangular(renderer),
    loadMap(`${import.meta.env.BASE_URL}assets/room/tank_glow.png`, SRGBColorSpace),
  ]);
  for (const map of [lightmap, tankLightmap]) {
    map.magFilter = LinearFilter;
    map.minFilter = LinearFilter;
  }
  const lightmaps = { all: lightmap, tankOnly: tankLightmap };
  tankImage.flipY = true;
  tankImage.generateMipmaps = true;

  const behind = new Scene();
  const front = new Scene();
  behind.environment = environment;
  front.environment = environment;

  const meshes: Mesh[] = [];
  (gltf.scene as Group).traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  gltf.scene.updateMatrixWorld(true);
  for (const mesh of meshes) {
    // A multi-material object arrives as a group of meshes, with the part name on the group.
    const name = /^(behind|front)_/.test(mesh.name) ? mesh.name : (mesh.parent?.name ?? mesh.name);
    const spec = SURFACES[name];
    if (spec !== undefined) {
      mesh.material = await createBakedMaterial(spec, lightmaps, name === 'behind_floor' ? tankOnFloor(tankImage) : null);
    } else if (name === 'front_led') {
      const glow = new MeshStandardNodeMaterial({ color: 0x000000 });
      glow.emissiveNode = vec3(1, 0.72, 0.42).mul(LED_BRIGHTNESS);
      mesh.material = glow;
    } else if (name === 'front_ledbar') {
      const bar = new MeshStandardNodeMaterial({ color: 0x000000 });
      bar.emissiveNode = vec3(0.95, 1, 0.98).mul(LED_BAR_BRIGHTNESS).mul(lightTint);
      mesh.material = bar;
    } else if (name === 'front_switch_led') {
      // A thin indicator under the rocker, lit in the tank light's current colour.
      const indicator = new MeshStandardNodeMaterial({ color: 0x000000 });
      indicator.emissiveNode = vec3(...TUNED_WHITE).mul(lightTint).mul(SWITCH_INDICATOR_BRIGHTNESS);
      mesh.material = indicator;
    } else if (name === 'front_screen') {
      // A matte panel: a glossy one mirrored the LED strip as a bright streak across the picture.
      const screen = new MeshStandardNodeMaterial({ color: 0x000000, roughness: 0.6 });
      screen.envMapIntensity = 0.12;
      // The picture loads the right way up, while glTF counts V from the top.
      screen.emissiveNode = texture(tankImage, vec2(uv().x, float(1).sub(uv().y))).rgb.mul(lightTint).mul(SCREEN_BRIGHTNESS);
      mesh.material = screen;
    } else {
      throw new Error(`room.glb has a mesh named "${name}" with no surface defined for it in src/room/room.ts.`);
    }
    (name.startsWith('behind_') ? behind : front).attach(mesh);
  }
  const plate = front.getObjectByName('front_switch');
  if (plate === undefined) throw new Error(`${url} has no light switch (front_switch). Rebuild it with tools/blender/build_room.py.`);
  return { behind, front, environment, switchBounds: new Box3().setFromObject(plate) };
};
