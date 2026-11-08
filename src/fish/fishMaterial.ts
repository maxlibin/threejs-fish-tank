import {
  Fn, bool, cameraViewMatrix, clamp, dFdx, dFdy, dot, faceDirection, float, fract, interleavedGradientNoise, mix, normalize, normalGeometry, positionView, screenCoordinate, smoothstep, texture, transformDirection, uniform, uv, varying, vec3, cross,
} from 'three/tsl';
import { MeshPhysicalNodeMaterial, MeshSSSNodeMaterial, type Node, type Texture } from 'three/webgpu';
import { lightTint } from '../tank/lightColours';
import { applyPortalOptics, insidePortalNode, portalUniforms, setObjectMotion } from '../tank/refractionNodes';
import { applySoftWaterLook } from '../water/volume';
import type { FishSwimNodes } from './swimNodes';

export type FishMaps = {
  readonly baseColor: Texture;
  readonly normal: Texture;
  /** r roughness, g metalness, b iridescence, a thickness. */
  readonly material: Texture;
  readonly eye: Texture;
};

/** Changes each frame by the golden ratio, so that a pixel's thresholds evenly cover 0-1 over time. */
export const stochasticFrame = uniform(0);

/** Compared with opacity to draw see-through surfaces; the temporal resolve averages the result smooth. */
export const stochasticThreshold = fract(interleavedGradientNoise(screenCoordinate).add(stochasticFrame));

/** Below 1 this makes faint fins a little more visible, while opaque skin stays opaque. */
const FIN_OPACITY_POWER = 0.7;
const STREAK_START = 0.2;
const STREAK_FULL = 0.62;
const STREAK_SOFTENING = 5;
/** The skin is a photograph, with its light already in it, so scene light only adds to it. */
const SKIN_SELF_LIGHT = 0.6;
const SKIN_LIT_SHARE = 0.42;
const NORMAL_STRENGTH = 0.9;
const IRIDESCENCE_STRENGTH = 0.85;

/** The surface normal with the normal map applied, built from screen derivatives so no tangents are needed. */
const mappedNormal = (worldNormal: Node<'vec3'>, normalMap: Texture): Node<'vec3'> =>
  Fn(() => {
    const normal = normalize(transformDirection(worldNormal, cameraViewMatrix)).mul(faceDirection).mul(portalUniforms.normalSign);
    const dp1 = dFdx(positionView);
    const dp2 = dFdy(positionView);
    const duv1 = dFdx(uv());
    const duv2 = dFdy(uv());
    const dp2perp = cross(dp2, normal);
    const dp1perp = cross(normal, dp1);
    const tangent = dp2perp.mul(duv1.x).add(dp1perp.mul(duv2.x));
    const bitangent = dp2perp.mul(duv1.y).add(dp1perp.mul(duv2.y));
    const scale = float(1).div(dot(tangent, tangent).max(dot(bitangent, bitangent)).max(1e-14).sqrt());
    const sampled = texture(normalMap).xyz.mul(2).sub(1).mul(vec3(NORMAL_STRENGTH, NORMAL_STRENGTH, 1));
    return normalize(tangent.mul(scale).mul(sampled.x).add(bitangent.mul(scale).mul(sampled.y)).add(normal.mul(sampled.z)));
  })();

/** Silver scales that shimmer with viewing angle, and thin fins that let light through, drawn with stochastic transparency. */
export const createFishBodyMaterial = (maps: FishMaps, swim: FishSwimNodes): MeshSSSNodeMaterial => {
  const material = applySoftWaterLook(applyPortalOptics(new MeshSSSNodeMaterial()));
  const base = texture(maps.baseColor);
  // The skin is a photo projected from the side, so surfaces turned away from that direction would show
  // long streaks. A softer version of the texture hides them, on the back and belly of a fish facing the viewer.
  const turnedAway = smoothstep(float(STREAK_START), float(STREAK_FULL), varying(normalGeometry.z).abs());
  const skinColor = texture(maps.baseColor).level(turnedAway.oneMinus().mul(STREAK_SOFTENING)).rgb;
  const surface = texture(maps.material);
  material.positionNode = swim.positionNode;
  material.castShadowPositionNode = swim.positionNode;
  material.roughnessNode = surface.r;
  material.metalnessNode = surface.g;
  material.iridescenceNode = surface.b.mul(IRIDESCENCE_STRENGTH);
  material.iridescenceIORNode = float(1.55);
  material.iridescenceThicknessNode = mix(float(260), float(460), surface.b);
  material.normalNode = mappedNormal(swim.worldNormal, maps.normal);
  material.thicknessColorNode = base.rgb.mul(clamp(float(1).sub(surface.a), 0, 1));
  material.thicknessDistortionNode = float(0.12);
  material.thicknessAttenuationNode = float(0.7);
  material.thicknessPowerNode = float(2.2);
  material.thicknessScaleNode = float(5);
  // The body is opaque, and fins let whatever is behind them show through, as the texture's alpha says.
  material.transparent = true;
  // Otherwise three.js draws every double-sided transparent mesh twice, back faces then front.
  material.forceSinglePass = true;
  material.opacityNode = base.a.pow(FIN_OPACITY_POWER);
  material.colorNode = skinColor.mul(SKIN_LIT_SHARE);
  material.emissiveNode = skinColor.mul(SKIN_SELF_LIGHT).mul(lightTint);
  material.maskNode = bool(insidePortalNode).and(base.a.greaterThan(0.03));
  setObjectMotion(material, swim.worldMotion);
  return material;
};

/** A clear, wet eye: the iris under a sharp glossy highlight. */
export const createFishEyeMaterial = (maps: FishMaps, swim: FishSwimNodes): MeshPhysicalNodeMaterial => {
  const material = applySoftWaterLook(applyPortalOptics(new MeshPhysicalNodeMaterial({ roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03 })));
  material.positionNode = swim.positionNode;
  material.castShadowPositionNode = swim.positionNode;
  material.colorNode = texture(maps.eye, uv()).rgb.mul(SKIN_LIT_SHARE);
  material.emissiveNode = texture(maps.eye, uv()).rgb.mul(SKIN_SELF_LIGHT).mul(lightTint);
  material.normalNode = normalize(transformDirection(swim.worldNormal, cameraViewMatrix)).mul(faceDirection).mul(portalUniforms.normalSign);
  setObjectMotion(material, swim.worldMotion);
  return material;
};
