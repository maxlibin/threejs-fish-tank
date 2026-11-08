import WebGPU from 'three/addons/capabilities/WebGPU.js';
import { WebGPURenderer } from 'three/webgpu';

export class WebGPUUnavailableError extends Error {
  override name = 'WebGPUUnavailableError';
}

export class GPUDeviceLostError extends Error {
  override name = 'GPUDeviceLostError';
}

/** The parts of the native GPU device this app uses; three.js does not type its backend's device. */
export type NativeGPUDevice = {
  readonly lost: Promise<{ readonly reason: string; readonly message: string }>;
  destroy(): void;
};

type WebGPUBackendShape = { readonly isWebGPUBackend?: boolean; readonly device?: NativeGPUDevice };

/**
 * Creates the renderer. WebGPURenderer silently falls back to WebGL 2 by default, and this
 * scene cannot be produced on that backend, so anything but real WebGPU is an error.
 */
export const createRenderer = async (canvas: HTMLCanvasElement): Promise<WebGPURenderer> => {
  if (!WebGPU.isAvailable()) {
    throw new WebGPUUnavailableError(
      'This aquarium needs WebGPU, which is not available in this browser. Open it in a current version of Chrome.',
    );
  }
  const renderer = new WebGPURenderer({ canvas, antialias: false });
  await renderer.init();
  if ((renderer.backend as unknown as WebGPUBackendShape).isWebGPUBackend !== true) {
    throw new WebGPUUnavailableError(
      'This aquarium needs WebGPU, but the browser could only start WebGL. Open it in a current version of Chrome.',
    );
  }
  return renderer;
};

/** Returns the native device behind a renderer made by createRenderer. */
export const nativeDevice = (renderer: WebGPURenderer): NativeGPUDevice => {
  const { device } = renderer.backend as unknown as WebGPUBackendShape;
  if (device === undefined) throw new WebGPUUnavailableError('The WebGPU backend has no device after init.');
  return device;
};

/** The error shown when the GPU goes away, for example after the Mac sleeps. */
export const deviceLostError = (reason: string, message: string): GPUDeviceLostError =>
  new GPUDeviceLostError(`The graphics device was lost (${reason}: ${message}). Please reload the page.`);
