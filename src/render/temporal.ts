import { Fn, clamp, float, ivec2, max, min, mix, screenUV, texture, textureLoad, uniform, vec2, vec3, vec4 } from 'three/tsl';
import {
  HalfFloatType, LinearFilter, Matrix4, NoBlending, PerspectiveCamera, QuadMesh, MeshBasicNodeMaterial, RenderTarget, Vector2,
  type Node, type Texture, type WebGPURenderer,
} from 'three/webgpu';

/** Share of the current frame in the running average. Lower is smoother but slower to respond. */
const CURRENT_WEIGHT = 0.1;
const JITTER_LENGTH = 16;
const NEIGHBOURS: readonly (readonly [number, number])[] = [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

const halton = (index: number, base: number): number => {
  const step = (i: number, fraction: number, result: number): number =>
    i === 0 ? result : step(Math.floor(i / base), fraction / base, result + fraction * (i % base));
  return step(index, 1 / base, 0);
};

/** Sub-pixel camera offsets, in pixels, cycled each frame so edges resolve over time. */
export const jitterSequence: readonly (readonly [number, number])[] = Array.from({ length: JITTER_LENGTH }, (_, index) => [
  halton(index + 1, 2) - 0.5,
  halton(index + 1, 3) - 0.5,
]);

export type CameraMotion = {
  /** Screen motion in UV between where a point was last frame and where it is now. */
  velocityNode(previousWorldPosition: Node<'vec3'>, worldPosition: Node<'vec3'>): Node<'vec2'>;
  /** Call once per frame before drawing, with the camera's unjittered matrices current. */
  capture(camera: PerspectiveCamera): void;
};

const createCameraMotion = (): CameraMotion => {
  const current = uniform(new Matrix4());
  const previous = uniform(new Matrix4());
  return {
    velocityNode: (previousWorldPosition: Node<'vec3'>, worldPosition: Node<'vec3'>): Node<'vec2'> =>
      Fn(() => {
        const now = current.mul(vec4(worldPosition, 1)).toVar();
        const before = previous.mul(vec4(previousWorldPosition, 1)).toVar();
        return now.xy.div(now.w).sub(before.xy.div(before.w)).mul(vec2(0.5, -0.5));
      })(),
    capture: (camera: PerspectiveCamera): void => {
      previous.value.copy(current.value);
      current.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    },
  };
};

/** The one camera in the scene, so every material can read its motion without being handed it. */
export const cameraMotion = createCameraMotion();

export type TemporalResolve = {
  outputNode: Node<'vec4'>;
  update(renderer: WebGPURenderer): void;
  setSize(width: number, height: number): void;
};

/** Accumulates jittered frames, following motion and rejecting history that no longer matches. */
export const createTemporalResolve = (color: Texture, velocity: Texture): TemporalResolve => {
  const options = { type: HalfFloatType, magFilter: LinearFilter, minFilter: LinearFilter, depthBuffer: false };
  const resolved = new RenderTarget(4, 4, options);
  const history = new RenderTarget(4, 4, options);
  const texelSize = uniform(new Vector2(1 / 4, 1 / 4));
  let hasHistory = false;
  const historyWeight = uniform(0);

  const material = new MeshBasicNodeMaterial({ blending: NoBlending, depthTest: false, depthWrite: false });
  material.colorNode = Fn(() => {
    const currentColor = texture(color, screenUV);
    const motion = texture(velocity, screenUV).xy;
    const previousUv = screenUV.sub(motion);

    const low = vec3(1e6).toVar();
    const high = vec3(-1e6).toVar();
    const pixel = ivec2(screenUV.div(texelSize));
    for (const [dx, dy] of NEIGHBOURS) {
      const sample = textureLoad(color, pixel.add(ivec2(dx, dy))).rgb;
      low.assign(min(low, sample));
      high.assign(max(high, sample));
    }

    const past = clamp(texture(history.texture, previousUv).rgb, low, high);
    const inside = previousUv.x.greaterThanEqual(0).and(previousUv.x.lessThanEqual(1)).and(previousUv.y.greaterThanEqual(0)).and(previousUv.y.lessThanEqual(1));
    const weight = inside.select(float(1 - CURRENT_WEIGHT), float(0)).mul(historyWeight);
    return vec4(mix(currentColor.rgb, past, weight), 1);
  })();
  const quad = new QuadMesh(material);

  return {
    outputNode: texture(resolved.texture, screenUV),
    update: (renderer: WebGPURenderer): void => {
      historyWeight.value = hasHistory ? 1 : 0;
      renderer.setRenderTarget(resolved);
      quad.render(renderer);
      renderer.setRenderTarget(null);
      renderer.copyTextureToTexture(resolved.texture, history.texture);
      hasHistory = true;
    },
    setSize: (width: number, height: number): void => {
      resolved.setSize(width, height);
      history.setSize(width, height);
      texelSize.value.set(1 / width, 1 / height);
      hasHistory = false;
    },
  };
};
