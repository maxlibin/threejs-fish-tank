import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { float, fract, luminance, pow, interleavedGradientNoise, length, mix, mrt, output, perspectiveDepthToViewZ, positionWorld, renderOutput, screenCoordinate, screenUV, smoothstep, texture, uniform, vec3, vec4 } from 'three/tsl';
import {
  DepthTexture, LinearSRGBColorSpace, NeutralToneMapping, NoToneMapping, FloatType, HalfFloatType, LinearFilter, RenderPipeline, RenderTarget, SRGBColorSpace,
  type Node, type PerspectiveCamera, type WebGPURenderer,
} from 'three/webgpu';
import { stochasticFrame } from '../fish/fishMaterial';
import { cameraMotion, createTemporalResolve, jitterSequence } from './temporal';

export type ImagePipeline = {
  /** Draws a frame. `drawContents` issues the scene draws into the pipeline's target. */
  render(drawContents: () => void): void;
  setFocusDistance(metres: number): void;
  resize(width: number, height: number): void;
};

const FOCAL_RANGE_METRES = 0.4;
const FOCAL_RANGE_GROWTH = 0.28;
const BOKEH_SCALE = 3.4;
/** Restores the last bit of crispness that temporal averaging removes. */
const SHARPENING = 0.12;
/** A little extra contrast and colour, as a camera's vivid picture profile gives. */
const LOOK_CONTRAST = 1.18;
const LOOK_SATURATION = 1.04;
/** The scene renders below display resolution; temporal resolve and sharpening bring the detail back. */
const RENDER_SCALE = 0.8;
const EXPOSURE = 0.95;
/** A soft halo around the LEDs and other lights brighter than white, as a camera lens gives. */
const BLOOM_STRENGTH = 0.09;
const BLOOM_RADIUS = 0.4;
const BLOOM_THRESHOLD = 1.6;
const GRAIN_STRENGTH = 0.012;
const VIGNETTE_STRENGTH = 0.18;

/**
 * Renders the scene the way a camera would: jittered samples resolved over time, depth of field,
 * neutral tone mapping, and a trace of vignette and grain.
 */
export const createImagePipeline = (renderer: WebGPURenderer, camera: PerspectiveCamera): ImagePipeline => {
  const target = new RenderTarget(4, 4, { count: 2, type: HalfFloatType, magFilter: LinearFilter, minFilter: LinearFilter });
  const colorTexture = target.textures[0];
  const velocityTexture = target.textures[1];
  if (colorTexture === undefined || velocityTexture === undefined) throw new Error('The pipeline target did not create its two textures.');
  colorTexture.name = 'output';
  velocityTexture.name = 'velocity';
  velocityTexture.type = FloatType;
  const depthTexture = new DepthTexture(4, 4);
  depthTexture.type = FloatType;
  target.depthTexture = depthTexture;

  const sceneMrt = mrt({ output, velocity: vec4(cameraMotion.velocityNode(positionWorld, positionWorld), 0, 1) });
  const temporal = createTemporalResolve(colorTexture, velocityTexture);

  const focusDistance = uniform(1);
  const focalRange = uniform(FOCAL_RANGE_METRES);
  const viewZ = perspectiveDepthToViewZ(texture(depthTexture, screenUV).r, float(camera.near), float(camera.far));
  const crisp = sharpen(temporal.outputNode, SHARPENING, false) as unknown as Node<'vec4'>;
  const focused = dof(crisp, viewZ, focusDistance, focalRange, BOKEH_SCALE);

  const finish = (color: Node<'vec4'>): Node<'vec4'> => {
    const toneMapped = renderOutput(color, NeutralToneMapping, LinearSRGBColorSpace).rgb;
    const contrasted = pow(toneMapped, vec3(LOOK_CONTRAST));
    const graded = mix(vec3(luminance(contrasted)), contrasted, LOOK_SATURATION).max(vec3(0));
    const encoded = renderOutput(vec4(graded, 1), NoToneMapping, SRGBColorSpace);
    const fromCentre = length(screenUV.sub(0.5));
    const vignette = mix(float(1), float(1 - VIGNETTE_STRENGTH), smoothstep(0.35, 0.85, fromCentre));
    const grain = fract(interleavedGradientNoise(screenCoordinate)).sub(0.5).mul(GRAIN_STRENGTH);
    return vec4(encoded.rgb.mul(vignette).add(vec3(grain)), 1);
  };

  const pipeline = new RenderPipeline(renderer);
  pipeline.outputColorTransform = false;
  const glow = bloom(focused as unknown as Node<'vec4'>, BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD) as unknown as Node<'vec4'>;
  pipeline.outputNode = finish((focused as unknown as Node<'vec4'>).add(glow));
  renderer.toneMappingExposure = EXPOSURE;

  let jitterIndex = 0;

  return {
    render: (drawContents: () => void): void => {
      camera.updateMatrixWorld();
      cameraMotion.capture(camera);
      const [jitterX, jitterY] = jitterSequence[jitterIndex % jitterSequence.length] ?? [0, 0];
      jitterIndex = (jitterIndex + 1) % jitterSequence.length;
      stochasticFrame.value = (jitterIndex * 0.618034) % 1;
      camera.setViewOffset(target.width, target.height, jitterX, jitterY, target.width, target.height);
      renderer.setMRT(sceneMrt);
      renderer.setRenderTarget(target);
      renderer.clear();
      drawContents();
      renderer.setRenderTarget(null);
      renderer.setMRT(null);
      camera.clearViewOffset();
      temporal.update(renderer);
      pipeline.render();
    },
    setFocusDistance: (metres: number): void => {
      focusDistance.value = metres;
      // A real lens holds more of the scene sharp when focused farther away.
      focalRange.value = FOCAL_RANGE_METRES + metres * metres * FOCAL_RANGE_GROWTH;
    },
    resize: (width: number, height: number): void => {
      const scaledWidth = Math.floor(width * RENDER_SCALE);
      const scaledHeight = Math.floor(height * RENDER_SCALE);
      target.setSize(scaledWidth, scaledHeight);
      temporal.setSize(scaledWidth, scaledHeight);
    },
  };
};
