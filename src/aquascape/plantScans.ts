import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { attribute, bool, float, luminance, mix, normalMap, positionWorld, smoothstep, texture, vec3 } from 'three/tsl';
import { Group, Mesh, MeshStandardMaterial, MeshStandardNodeMaterial, type Node, type Object3D } from 'three/webgpu';
import { TANK } from '../tank/dimensions';
import { applyPortalOptics, insidePortalNode, portalUniforms } from '../tank/refractionNodes';
import { applySoftWaterLook } from '../water/volume';
import { plantSwayNode } from './plantNodes';

/** Warm toward the photo's yellow-greens, with a little difference from plant to plant. */
const WARM_END = vec3(1.95, 1.72, 0.62);
const COOL_END = vec3(1.62, 1.58, 0.7);
/** Vertex alpha runs from 0.5 on the left of the tank to 1 on the right; this sets what those mean. */
const BRIGHTNESS_RANGE = 1.5;
const SCATTERED_LIGHT = 0.55;
/** Leaves near the LED bar catch far more light than those in the shade low down, as in the photo. */
const LOW_LEAF_LIGHT = 0.42;
const HIGH_LEAF_LIGHT = 1.15;
/** Strong white light washes out the green of the leaves nearest the bar. */
const HIGH_LEAF_PALENESS = 0.15;
const LOW_LEAF_Y = TANK.standTopY + 0.3;
const HIGH_LEAF_Y = TANK.standTopY + 0.9;
const ALPHA_CUTOFF = 0.5;
const CARD_BACKGROUND = 0.018;

const createScanMaterial = (source: MeshStandardMaterial): MeshStandardNodeMaterial => {
  const material = applySoftWaterLook(applyPortalOptics(new MeshStandardNodeMaterial({ metalness: 0 })));
  if (source.map === null) throw new Error(`The scanned plant material "${source.name}" has no colour map. Rebuild it with tools/blender/build_aquascape.py.`);
  const masks = attribute('color', 'vec4') as unknown as Node<'vec4'>;
  const base = texture(source.map);
  const nearBar = smoothstep(float(LOW_LEAF_Y), float(HIGH_LEAF_Y), positionWorld.y);
  const lit = base.rgb.mul(mix(WARM_END, COOL_END, masks.b)).mul(masks.a.mul(BRIGHTNESS_RANGE)).mul(mix(float(LOW_LEAF_LIGHT), float(HIGH_LEAF_LIGHT), nearBar));
  const color = mix(lit, vec3(luminance(lit)), nearBar.mul(HIGH_LEAF_PALENESS));
  const sway = plantSwayNode();
  material.positionNode = sway;
  material.castShadowPositionNode = sway;
  material.colorNode = color;
  material.roughnessMap = source.roughnessMap;
  material.roughness = source.roughness;
  if (source.normalMap !== null) material.normalNode = normalMap(texture(source.normalMap)).mul(portalUniforms.normalSign);
  // Light passes through leaves and scatters among them, so even shaded ones glow softly; more on the bright right.
  material.emissiveNode = color.mul(masks.a.mul(masks.a).mul(SCATTERED_LIGHT));
  // Some scans keep leaves on cards with a near-black background and no usable transparency.
  const isLeaf = base.a.greaterThan(ALPHA_CUTOFF).and(luminance(base.rgb).greaterThan(CARD_BACKGROUND));
  material.maskNode = bool(insidePortalNode).and(isLeaf);
  material.maskShadowNode = isLeaf;
  return material;
};

/** Loads the real scanned plants, already composed into place. */
export const loadPlantScans = async (): Promise<Group> => {
  const url = '/assets/aquascape/plantscans.glb';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}. Rebuild it with tools/blender/build_aquascape.py.`);
  const gltf = await new GLTFLoader().parseAsync(await response.arrayBuffer(), '');
  const materials = new Map<string, MeshStandardNodeMaterial>();
  gltf.scene.traverse((object: Object3D) => {
    if (!(object instanceof Mesh) || !(object.material instanceof MeshStandardMaterial)) return;
    const source = object.material;
    const known = materials.get(source.uuid);
    const material = known ?? createScanMaterial(source);
    materials.set(source.uuid, material);
    object.material = material;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return gltf.scene;
};
