export type FrameStats = {
  readonly averageFps: number;
  readonly minimumFps: number;
  readonly onePercentLowFps: number;
  readonly frameCount: number;
  readonly backend: 'webgpu' | 'webgl';
};

export type FrameWindow = { readonly seconds: readonly number[]; readonly frameCount: number };

const WINDOW_FRAMES = 600;
const SLOWEST_SHARE = 0.01;

export const emptyFrameWindow: FrameWindow = { seconds: [], frameCount: 0 };

export const addFrame = (window: FrameWindow, frameSeconds: number): FrameWindow => ({
  seconds: [...window.seconds.slice(-(WINDOW_FRAMES - 1)), frameSeconds],
  frameCount: window.frameCount + 1,
});

/** Frame rate across the slowest 1% of frames, which a single stray frame cannot dominate. */
const onePercentLow = (seconds: readonly number[]): number => {
  if (seconds.length === 0) return 0;
  const slowest = [...seconds].sort((a, b) => b - a).slice(0, Math.ceil(seconds.length * SLOWEST_SHARE));
  return slowest.length / slowest.reduce((sum, frame) => sum + frame, 0);
};

export const summarizeFrames = (window: FrameWindow, backend: FrameStats['backend']): FrameStats => {
  const total = window.seconds.reduce((sum, seconds) => sum + seconds, 0);
  return {
    averageFps: total === 0 ? 0 : window.seconds.length / total,
    minimumFps: window.seconds.length === 0 ? 0 : 1 / Math.max(...window.seconds),
    onePercentLowFps: onePercentLow(window.seconds),
    frameCount: window.frameCount,
    backend,
  };
};
