import {
  Fn, dFdx, dFdy, float, length, max, min, mix, normalize, positionGeometry, refract, smoothstep, texture, varying, vec2, vec3, vec4,
} from 'three/tsl';
import {
  AdditiveBlending, DoubleSide, HalfFloatType, LinearFilter, Mesh, MeshBasicNodeMaterial, OrthographicCamera, PlaneGeometry, RenderTarget, Scene, Vector3,
  type Node, type WebGPURenderer,
} from 'three/webgpu';
import { TANK } from '../tank/dimensions';
import { surfaceNormalNode } from './surface';

export type Caustics = {
  update(): void;
  /** Light brightness multiplier at a world position under the water; averages about 1. */
  causticsAtNode(worldPosition: Node<'vec3'>): Node<'vec3'>;
  /** The same pattern without colour fringes, for sampling many times along a ray. */
  brightnessAtNode(worldPosition: Node<'vec3'>): Node<'float'>;
};

export const LIGHT_DIRECTION = new Vector3(0.12, -1, 0.08).normalize();

const INNER_WIDTH = TANK.width - 2 * TANK.glassThickness;
const INNER_DEPTH = TANK.depth - 2 * TANK.glassThickness;
const ETA = 1 / TANK.iorWater;
/** Depth at which the pattern is computed: about the height of the sand under the surface. */
const FOCUS_DEPTH = 1.0;
const TARGET_WIDTH = 3072;
const TARGET_DEPTH = 720;
const GRID_SEGMENTS_X = 1000;
const GRID_SEGMENTS_Z = 240;
const DISPERSION_PER_METRE = 0.0018;
const SHALLOW_FADE_DEPTH = 0.5;
/** How strongly the focused pattern shows; ambient light in a real tank softens it a lot. */
const PATTERN_STRENGTH = 0.32;
/** A fold in the mesh has zero area. Real focus is limited, and this keeps it from flaring. */
const MAX_FOCUS = 12;

const lightDirection = vec3(LIGHT_DIRECTION.x, LIGHT_DIRECTION.y, LIGHT_DIRECTION.z);
const meanRefracted = refract(lightDirection, vec3(0, 1, 0), ETA);
/** Horizontal travel of the undisturbed refracted light per metre of depth. */
const driftPerMetre = meanRefracted.xz.div(meanRefracted.y.negate());

/** Maps a mesh of the surface to where each point's light lands; brightness is the change in area. */
const createCausticMaterial = (): MeshBasicNodeMaterial => {
  // Double-sided because steep ripples fold the mesh over itself, which is what makes bright caustic lines.
  const material = new MeshBasicNodeMaterial({ transparent: true, blending: AdditiveBlending, depthTest: false, depthWrite: false, side: DoubleSide });
  const worldXZ = positionGeometry.xy;
  const refracted = refract(lightDirection, surfaceNormalNode(worldXZ), ETA);
  const landed = worldXZ.add(refracted.xz.div(refracted.y.negate()).sub(driftPerMetre).mul(FOCUS_DEPTH));
  material.vertexNode = vec4(landed.x.div(INNER_WIDTH / 2), landed.y.div(INNER_DEPTH / 2), 0, 1);
  const before = varying(worldXZ);
  const after = varying(landed);
  const area = (point: Node<'vec2'>): Node<'float'> => length(dFdx(point)).mul(length(dFdy(point)));
  material.colorNode = vec3(min(area(before).div(max(area(after), float(1e-9))), float(MAX_FOCUS)));
  return material;
};

/** Computes real focused-light patterns from the water surface, which a tiled texture could never match. */
export const createCaustics = (renderer: WebGPURenderer): Caustics => {
  const target = new RenderTarget(TARGET_WIDTH, TARGET_DEPTH, { type: HalfFloatType, magFilter: LinearFilter, minFilter: LinearFilter, depthBuffer: false });
  const scene = new Scene();
  const mesh = new Mesh(new PlaneGeometry(INNER_WIDTH, INNER_DEPTH, GRID_SEGMENTS_X, GRID_SEGMENTS_Z), createCausticMaterial());
  mesh.frustumCulled = false;
  scene.add(mesh);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const sample = Fn(([worldXZ]: [Node<'vec2'>]) => texture(target.texture, vec2(worldXZ.x.div(INNER_WIDTH).add(0.5), float(0.5).sub(worldXZ.y.div(INNER_DEPTH)))).r);

  return {
    update: (): void => {
      renderer.setRenderTarget(target);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
    },
    brightnessAtNode: (worldPosition: Node<'vec3'>): Node<'float'> => {
      const depth = max(float(TANK.waterSurfaceY).sub(worldPosition.y), float(0));
      return mix(float(1), sample(worldPosition.xz.sub(driftPerMetre.mul(depth))), smoothstep(0, SHALLOW_FADE_DEPTH, depth).mul(PATTERN_STRENGTH));
    },
    causticsAtNode: (worldPosition: Node<'vec3'>): Node<'vec3'> => {
      const depth = max(float(TANK.waterSurfaceY).sub(worldPosition.y), float(0));
      const columnXZ = worldPosition.xz.sub(driftPerMetre.mul(depth));
      const spread = normalize(vec2(1, 0.4)).mul(depth).mul(DISPERSION_PER_METRE);
      const pattern = vec3(sample(columnXZ.add(spread)), sample(columnXZ), sample(columnXZ.sub(spread)));
      return mix(vec3(1), pattern, smoothstep(0, SHALLOW_FADE_DEPTH, depth).mul(PATTERN_STRENGTH));
    },
  };
};
