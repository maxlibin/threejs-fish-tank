import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attribute, mix, normalMap, texture, uv } from 'three/tsl';
import {
  Color, Group, Mesh, MeshStandardMaterial, MeshStandardNodeMaterial, NoColorSpace, RepeatWrapping, SRGBColorSpace, TextureLoader,
  type Node, type Object3D, type Texture,
} from 'three/webgpu';
import { applyPortalOptics, portalUniforms } from '../tank/refractionNodes';
import { applySoftWaterLook, applyWaterLook } from '../water/volume';

const WOOD_TINT = new Color(0.62, 0.56, 0.44);
/** The forked branches are pale desert wood, so they need darkening much more to look waterlogged. */
const BRANCH_TINT = new Color(0.2, 0.15, 0.11);
const ROCK_TINT = new Color(0.9, 0.84, 0.72);
const SAND_TILES_PER_METRE = 3.2;
const SOIL_TILES_PER_METRE = 3.8;

const submerged = <T extends MeshStandardNodeMaterial>(material: T): T => applySoftWaterLook(applyPortalOptics(material));

const loadTiled = async (url: string, colorSpace: typeof SRGBColorSpace | typeof NoColorSpace): Promise<Texture> => {
  const map = await new TextureLoader().loadAsync(url).catch((cause: unknown) => {
    throw new Error(`Could not load the texture ${url}: ${String(cause)}.`);
  });
  map.wrapS = RepeatWrapping;
  map.wrapT = RepeatWrapping;
  map.colorSpace = colorSpace;
  map.anisotropy = 16;
  return map;
};

/** A scanned material made to work under water, with a tint that turns pale desert wood into waterlogged driftwood. */
const convertScannedMaterial = (source: MeshStandardMaterial, tint: Color): MeshStandardNodeMaterial => {
  const material = new MeshStandardNodeMaterial();
  material.map = source.map;
  material.color.copy(source.color).multiply(tint);
  material.normalMap = source.normalMap;
  material.roughnessMap = source.roughnessMap;
  material.metalnessMap = source.metalnessMap;
  material.roughness = source.roughness;
  material.metalness = source.metalness;
    return submerged(material);
};

/** Blends dark soil and pale sand by the mask painted into the terrain's vertex colours. */
const createTerrainMaterial = async (): Promise<MeshStandardNodeMaterial> => {
  const [sandColor, sandNormal, sandRough, soilColor, soilNormal, soilRough] = await Promise.all([
    loadTiled('/assets/aquascape/sand/diffuse.jpg', SRGBColorSpace),
    loadTiled('/assets/aquascape/sand/normal.jpg', NoColorSpace),
    loadTiled('/assets/aquascape/sand/rough.jpg', NoColorSpace),
    loadTiled('/assets/aquascape/soil/diffuse.jpg', SRGBColorSpace),
    loadTiled('/assets/aquascape/soil/normal.jpg', NoColorSpace),
    loadTiled('/assets/aquascape/soil/rough.jpg', NoColorSpace),
  ]);
  // Large and flat, so its light shafts need per-pixel detail.
  const material = applyWaterLook(applyPortalOptics(new MeshStandardNodeMaterial()));
  const mask = (attribute('color', 'vec4') as unknown as Node<'vec4'>).r;
  const sandUv = uv().mul(SAND_TILES_PER_METRE);
  const soilUv = uv().mul(SOIL_TILES_PER_METRE);
  material.colorNode = mix(texture(soilColor, soilUv).rgb.mul(0.28), texture(sandColor, sandUv).rgb.mul(0.86), mask);
  material.roughnessNode = mix(texture(soilRough, soilUv).r, texture(sandRough, sandUv).r, mask);
  material.normalNode = normalMap(mix(texture(soilNormal, soilUv).xyz, texture(sandNormal, sandUv).xyz, mask)).mul(portalUniforms.normalSign);
  return material;
};

const isPartNamed = (object: Object3D, prefix: string): boolean => object.name.startsWith(prefix);

/** Loads the composed rocks, wood, substrate, and equipment. */
export const loadHardscape = async (): Promise<Group> => {
  const url = '/assets/aquascape/hardscape.glb';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}. Rebuild it with tools/blender/build_aquascape.py.`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const terrainMaterial = await createTerrainMaterial();
  const plastic = submerged(new MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.45 }));
  const converted = new Map<string, MeshStandardNodeMaterial>();

  const materialFor = (mesh: Mesh): MeshStandardNodeMaterial => {
    if (isPartNamed(mesh, 'terrain')) return terrainMaterial;
    const source = mesh.material;
    const isScan = isPartNamed(mesh, 'rock') || isPartNamed(mesh, 'wood') || isPartNamed(mesh, 'branch');
    if (!isScan || !(source instanceof MeshStandardMaterial)) return plastic;
    const known = converted.get(source.uuid);
    if (known !== undefined) return known;
    const made = convertScannedMaterial(source, isPartNamed(mesh, 'branch') ? BRANCH_TINT : isPartNamed(mesh, 'wood') ? WOOD_TINT : ROCK_TINT);
    converted.set(source.uuid, made);
    return made;
  };

  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.material = materialFor(object);
    object.castShadow = !isPartNamed(object, 'terrain');
    object.receiveShadow = true;
  });
  return gltf.scene;
};
