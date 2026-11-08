import {
  Fn, attribute, cos, cross, float, instancedBufferAttribute, instanceIndex, max, normalize, positionGeometry, normalGeometry, sign, sin, uniform, varying, vec3,
} from 'three/tsl';
import type { InstancedBufferAttribute, Node } from 'three/webgpu';
import type { SpeciesParams } from './species';

export type FishInstanceAttributes = {
  /** xyz position, w scale. */
  readonly placement: InstancedBufferAttribute;
  /** Rotation quaternion. */
  readonly rotation: InstancedBufferAttribute;
  /** x swim phase, y amplitude, z turn curvature, w fin spread. */
  readonly swim: InstancedBufferAttribute;
  /** World motion over the last frame, for motion vectors. */
  readonly motion: InstancedBufferAttribute;
};

export type FishSwimNodes = {
  readonly positionNode: Node<'vec3'>;
  /** Interpolated world-space normal, including the bend of the body. */
  readonly worldNormal: Node<'vec3'>;
  readonly worldMotion: Node<'vec3'>;
};

const TWO_PI = float(Math.PI * 2);

/** Slow breathing and fin motion, in radians, wrapped so it never grows. Shared by all fish. */
export const breathPhase = uniform(0);

const rotateByQuaternion = (vector: Node<'vec3'>, quaternion: Node<'vec4'>): Node<'vec3'> => {
  const uv = cross(quaternion.xyz, vector).mul(2);
  return vector.add(uv.mul(quaternion.w)).add(cross(quaternion.xyz, uv));
};

/**
 * Bends the fish in the shader, so each one moves on its own without any animation loop. A wave runs
 * down the spine, growing toward the tail, and fins follow late. Vertex colour channels: r spine
 * position, g fin flex, b pectoral, a gill and mouth.
 */
export const createSwimNodes = (attributes: FishInstanceAttributes, params: SpeciesParams): FishSwimNodes => {
  const placement = instancedBufferAttribute(attributes.placement) as unknown as Node<'vec4'>;
  const rotation = instancedBufferAttribute(attributes.rotation) as unknown as Node<'vec4'>;
  const swim = instancedBufferAttribute(attributes.swim) as unknown as Node<'vec4'>;
  const motion = instancedBufferAttribute(attributes.motion) as unknown as Node<'vec3'>;
  const masks = attribute('color', 'vec4') as unknown as Node<'vec4'>;
  const length = float(params.bodyLength);

  const local = Fn(() => {
    const spine = masks.r;
    const wave = spine.mul(TWO_PI).mul(params.bodyWaves).sub(swim.x);
    const amplitude = swim.y.mul(length).mul(float(0.012).add(spine.mul(spine).mul(0.62)));
    const bend = amplitude.mul(sin(wave));
    const turn = swim.z.mul(length).mul(spine.sub(0.38).mul(spine.sub(0.38)));
    const finLag = swim.x.add(1.15);
    const finFlex = masks.g.mul(masks.g).mul(length).mul(params.finFlexStrength).mul(float(0.45).add(swim.y.mul(2))).mul(sin(spine.mul(TWO_PI).mul(params.bodyWaves).sub(finLag).add(masks.g)));
    const finRipple = masks.g.mul(masks.g).mul(length).mul(0.012).mul(sin(breathPhase.mul(2).add(positionGeometry.y.mul(60))));
    const side = sign(positionGeometry.z);
    const scull = masks.b.mul(masks.b).mul(length).mul(params.pectoralStrength).mul(sin(breathPhase.mul(3).add(instanceIndex.toFloat().mul(1.7)))).mul(side);
    const gills = float(1).add(masks.a.mul(0.07).mul(sin(breathPhase.add(instanceIndex.toFloat().mul(2.4)))));
    const folded = float(1).sub(masks.g.mul(float(1).sub(swim.w)).mul(0.22));
    return vec3(
      positionGeometry.x,
      positionGeometry.y.mul(folded),
      positionGeometry.z.mul(gills).add(bend).add(turn).add(finFlex).add(finRipple).add(scull),
    );
  });

  const bentNormal = Fn(() => {
    const spine = masks.r;
    const wave = spine.mul(TWO_PI).mul(params.bodyWaves).sub(swim.x);
    const amplitude = swim.y.mul(length).mul(float(0.012).add(spine.mul(spine).mul(0.62)));
    const slopeAlongSpine = amplitude.mul(cos(wave)).mul(TWO_PI).mul(params.bodyWaves).add(swim.y.mul(length).mul(spine).mul(1.24).mul(sin(wave)));
    const turnSlope = swim.z.mul(length).mul(spine.sub(0.38)).mul(2);
    // Spine position grows as x falls, so the sign of the slope flips.
    const dzdx = slopeAlongSpine.add(turnSlope).div(max(length, float(1e-4))).negate();
    return normalize(vec3(normalGeometry.x.sub(dzdx.mul(normalGeometry.z)), normalGeometry.y, normalGeometry.z));
  });

  const world = Fn(() => rotateByQuaternion(local().mul(placement.w), rotation).add(placement.xyz));

  return {
    positionNode: world(),
    worldNormal: varying(rotateByQuaternion(bentNormal(), rotation)),
    worldMotion: varying(motion),
  };
};
