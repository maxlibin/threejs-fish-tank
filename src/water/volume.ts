import { Fn, Loop, exp, float, int, interleavedGradientNoise, length, mix, output, positionWorld, screenCoordinate, smoothstep, varying, vec2, vec3, vec4 } from 'three/tsl';
import type { Node, NodeMaterial } from 'three/webgpu';
import { TANK } from '../tank/dimensions';
import { surfaceSlopeNode } from './surface';
import { crossingPoint, crossingPointAtVertex, portalUniforms, waterPathLength } from '../tank/refractionNodes';
import type { Caustics } from './caustics';

const ABSORPTION = vec3(0.22, 0.08, 0.09);
const SCATTERING = float(0.2);
const SCATTER_COLOR = vec3(0.15, 0.19, 0.2);
const SURFACE_GLOW = vec3(0.72, 0.78, 0.74);
const HAZE_LOW_DOWN = 0.35;
const HAZE_NEAR_LIGHT = 2.3;
const SHIMMER_FREQUENCY = 9;
const SHIMMER_STRENGTH = 0.55;
const SHAFT_SAMPLES = 4;
const SHAFT_STRENGTH = 0.65;

/** Set once at startup, so a material made at any time reads the one caustics pattern. */
let activeCaustics: Caustics | null = null;

export const useCaustics = (caustics: Caustics): void => {
  activeCaustics = caustics;
};

/** Light surviving a water path of the given length. Red fades first. */
export const absorptionNode = (color: Node<'vec3'>, pathLength: Node<'float'>): Node<'vec3'> =>
  color.mul(exp(ABSORPTION.mul(pathLength).negate()));

const inScatter = Fn(([pathLength, caustics]: [Node<'float'>, Caustics]) => {
  const jitter = interleavedGradientNoise(screenCoordinate);
  const total = float(0).toVar();
  Loop(int(SHAFT_SAMPLES), ({ i }: { i: Node<'int'> }) => {
    const t = i.toFloat().add(jitter).div(SHAFT_SAMPLES);
    total.addAssign(caustics.brightnessAtNode(mix(crossingPoint, positionWorld, t)));
  });
  const shaftBrightness = total.div(SHAFT_SAMPLES);
  const haze = float(1).sub(exp(SCATTERING.mul(pathLength).negate()));
  // Water glows brightest just under the LED bar.
  const nearLight = smoothstep(float(TANK.standTopY), float(TANK.waterSurfaceY), positionWorld.y);
  return SCATTER_COLOR.mul(haze).mul(mix(float(1), shaftBrightness, SHAFT_STRENGTH)).mul(mix(float(HAZE_LOW_DOWN), float(HAZE_NEAR_LIGHT), nearLight));
});

/**
 * The underside of the water seen from below: bright, with moving ripples of light that come from
 * the real surface. Vertical position on the back glass stands in for how far back the surface is.
 */
const surfaceGlowNode = (): Node<'vec3'> => {
  const towardViewer = float(1).sub(positionWorld.y.sub(TANK.standTopY).div(TANK.height)).sub(0.5).mul(TANK.depth);
  const slope = surfaceSlopeNode(vec2(positionWorld.x, towardViewer)).mul(SHIMMER_FREQUENCY);
  const ripple = slope.x.abs().add(slope.y.abs());
  return SURFACE_GLOW.mul(float(0.82).add(ripple.mul(SHIMMER_STRENGTH))).add(vec3(smoothstep(0.62, 1, ripple)).mul(0.5));
};

/** Haze sampled at each vertex: much cheaper, and detailed enough on small or finely divided objects. */
const inScatterAtVertex = (pathLength: Node<'float'>, caustics: Caustics): Node<'vec3'> =>
  Fn(() => {
    const middle = mix(crossingPointAtVertex, positionWorld, float(0.5));
    const far = mix(crossingPointAtVertex, positionWorld, float(0.85));
    const shaftBrightness = caustics.brightnessAtNode(middle).add(caustics.brightnessAtNode(far)).mul(0.5);
    const haze = float(1).sub(exp(SCATTERING.mul(pathLength).negate()));
    const nearLight = smoothstep(float(TANK.standTopY), float(TANK.waterSurfaceY), positionWorld.y);
    return SCATTER_COLOR.mul(haze).mul(mix(float(1), shaftBrightness, SHAFT_STRENGTH)).mul(mix(float(HAZE_LOW_DOWN), float(HAZE_NEAR_LIGHT), nearLight));
  })();

/** The water look for plants, fish, rocks, and wood, with its haze worked out per vertex. */
export const applySoftWaterLook = <T extends NodeMaterial>(material: T): T => {
  const caustics = activeCaustics;
  if (caustics === null) throw new Error('Call useCaustics before creating submerged materials.');
  const path = length(crossingPointAtVertex.sub(positionWorld));
  const haze = varying(inScatterAtVertex(path, caustics));
  material.outputNode = Fn(() => {
    const seen = absorptionNode(output.rgb, waterPathLength).add(haze);
    return vec4(mix(SURFACE_GLOW, seen, portalUniforms.mirrorStrength), output.a);
  })();
  return material;
};

/** Applies what water does between a surface and the eye: colour loss, haze, and faint light shafts. */
export const applyWaterLook = <T extends NodeMaterial>(material: T): T => {
  const caustics = activeCaustics;
  material.outputNode = Fn(() => {
    if (caustics === null) throw new Error('Call useCaustics before creating submerged materials.');
    const seen = absorptionNode(output.rgb, waterPathLength).add(inScatter(waterPathLength, caustics));
    return vec4(mix(surfaceGlowNode(), seen, portalUniforms.mirrorStrength), output.a);
  })();
  return material;
};
