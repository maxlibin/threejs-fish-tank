import {
  Fn, Loop, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, dot, float, int, length, materialNormal, max, min, mrt, normalize,
  positionWorld, renderGroup, sqrt, uniform, uniformArray, varying, vec3, vec4,
} from 'three/tsl';
import { Vector3, Vector4, DoubleSide, type Node, type NodeMaterial } from 'three/webgpu';
import { cameraMotion } from '../render/temporal';
import { surfaceSlopeNode } from '../water/surface';
import { NEWTON_ITERATIONS } from './refraction';
import { TANK } from './dimensions';

export type FloatNode = Node<'float'>;
export type Vec2Node = Node<'vec2'>;
export type Vec3Node = Node<'vec3'>;

export const MAX_CLIP_PLANES = 8;

/** Backing values of portalUniforms.clipPlanes, kept typed for writing. */
export const clipPlaneValues: readonly Vector4[] = Array.from({ length: MAX_CLIP_PLANES }, () => new Vector4(0, 0, 0, 1));

/** Values for the portal being drawn. Set before each draw of the tank's contents. */
export const portalUniforms = {
  planeNormal: uniform(new Vector3(0, 0, 1)).setGroup(renderGroup),
  planeConstant: uniform(0).setGroup(renderGroup),
  mirrorNormal: uniform(new Vector3(0, 0, 0)).setGroup(renderGroup),
  mirrorConstant: uniform(0).setGroup(renderGroup),
  secondMirrorNormal: uniform(new Vector3(0, 0, 0)).setGroup(renderGroup),
  secondMirrorConstant: uniform(0).setGroup(renderGroup),
  normalSign: uniform(1).setGroup(renderGroup),
  /** How much of a reflected image survives; the rest is the glow of the lit water surface. */
  mirrorStrength: uniform(1).setGroup(renderGroup),
  /** How strongly surface tilt moves the image: 2 in a surface mirror, about 0.25 through the top, else 0. */
  surfaceWobble: uniform(0).setGroup(renderGroup),
  clipPlanes: uniformArray([...clipPlaneValues], 'vec4').setGroup(renderGroup),
};

const IOR_WATER = float(TANK.iorWater);
const MIN_DEPTH = float(1e-6);

/** Shader version of solveRefractionCrossing in refraction.ts. */
const crossingPointNode = Fn(([eye, point]: [Vec3Node, Vec3Node]) => {
  const normal = portalUniforms.planeNormal;
  const eyeHeight = dot(normal, eye).add(portalUniforms.planeConstant);
  const pointDepth = max(dot(normal, point).add(portalUniforms.planeConstant).negate(), MIN_DEPTH);
  const eyeFoot = eye.sub(normal.mul(eyeHeight));
  const lateral = point.add(normal.mul(pointDepth)).sub(eyeFoot).toVar();
  const separation = length(lateral).toVar();
  const direction = lateral.div(max(separation, float(1e-9))).toVar();
  const x = separation.mul(eyeHeight).div(eyeHeight.add(IOR_WATER.mul(pointDepth))).toVar();

  Loop(int(NEWTON_ITERATIONS), () => {
    const rest = separation.sub(x);
    const airSquared = x.mul(x).add(eyeHeight.mul(eyeHeight));
    const waterSquared = rest.mul(rest).add(pointDepth.mul(pointDepth));
    const residual = x.div(sqrt(airSquared)).sub(IOR_WATER.mul(rest).div(sqrt(waterSquared)));
    const slope = eyeHeight.mul(eyeHeight).div(airSquared.mul(sqrt(airSquared))).add(
      IOR_WATER.mul(pointDepth).mul(pointDepth).div(waterSquared.mul(sqrt(waterSquared))),
    );
    x.assign(min(separation, max(float(0), x.sub(residual.div(slope)))));
  });

  return eyeFoot.add(direction.mul(x));
});

/** Shader version of apparentPosition: xyz is the apparent position, w the light path through water. */
const apparentPositionNode = Fn(([eye, point, crossing]: [Vec3Node, Vec3Node, Vec3Node]) => {
  const pathLength = length(crossing.sub(point)).toVar();
  const rayDirection = normalize(crossing.sub(eye));
  return vec4(crossing.add(rayDirection.mul(pathLength.div(IOR_WATER))), pathLength);
});

const reflectAcross = (point: Vec3Node, normal: Vec3Node, constant: FloatNode): Vec3Node =>
  point.sub(normal.mul(dot(normal, point).add(constant).mul(2)));

const mirroredWorldPosition = Fn(() => {
  const once = reflectAcross(positionWorld, portalUniforms.mirrorNormal, portalUniforms.mirrorConstant);
  const mirrored = reflectAcross(once, portalUniforms.secondMirrorNormal, portalUniforms.secondMirrorConstant);
  const depthBelowSurface = max(float(TANK.waterSurfaceY).sub(positionWorld.y), float(0));
  const shift = surfaceSlopeNode(positionWorld.xz).mul(depthBelowSurface).mul(portalUniforms.surfaceWobble);
  return mirrored.add(vec3(shift.x, 0, shift.y));
});

const seenPoint = mirroredWorldPosition();
const crossing = crossingPointNode(cameraPosition, seenPoint);
const apparent = apparentPositionNode(cameraPosition, seenPoint, crossing);

/** Where the current vertex's light path crosses into the water; usable in the vertex stage. */
export const crossingPointAtVertex: Vec3Node = crossing;

/** Where the current fragment's light path crosses into the water. */
export const crossingPoint: Vec3Node = varying(crossing);

/** Water path length of the current fragment's light path to the eye. */
export const waterPathLength: FloatNode = varying(apparent.w);

const insidePortal = Fn(() => {
  const position = varying(apparent.xyz);
  const inside = float(1).toVar();
  Loop(int(MAX_CLIP_PLANES), ({ i }: { i: Node<'int'> }) => {
    const plane = portalUniforms.clipPlanes.element(i) as unknown as Node<'vec4'>;
    inside.assign(min(inside, dot(plane.xyz, position).add(plane.w)));
  });
  return inside.greaterThanEqual(0);
});

/** True for fragments inside the active portal. Custom materials combine it with their own masks. */
export const insidePortalNode = insidePortal();

/** Adds an object's own world motion over the last frame to its motion vectors. */
export const setObjectMotion = (material: NodeMaterial, worldMotion: Vec3Node): void => {
  material.mrtNode = mrt({ velocity: vec4(cameraMotion.velocityNode(varying(apparent.xyz).sub(worldMotion), varying(apparent.xyz)), 0, 1) });
};

/**
 * Makes a material draw through the active portal: rasterized where refraction makes it appear,
 * cut to the portal, and shaded at its true position so light and shadows stay right.
 * Double-sided because mirror portals reverse triangle winding.
 */
export const applyPortalOptics = <T extends NodeMaterial>(material: T): T => {
  material.side = DoubleSide;
  material.vertexNode = cameraProjectionMatrix.mul(cameraViewMatrix).mul(vec4(apparent.xyz, 1));
  material.maskNode = insidePortalNode;
  material.normalNode = materialNormal.mul(portalUniforms.normalSign);
  setObjectMotion(material, vec3(0));
  return material;
};
