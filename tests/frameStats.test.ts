import { expect, test } from 'vitest';
import { summarizeFrames } from '../src/app/frameStats';

const framesAt = (fps: number, count: number): readonly number[] => Array.from({ length: count }, () => 1 / fps);
const lowFps = (seconds: readonly number[]): number => summarizeFrames({ seconds, frameCount: seconds.length }, 'webgpu').onePercentLowFps;

test('one stray slow frame does not sink the slowest 1% of frames', () => {
  expect(lowFps([...framesAt(100, 599), 1 / 38])).toBeGreaterThan(40);
});

test('a real slowdown does sink the slowest 1% of frames', () => {
  expect(lowFps([...framesAt(100, 590), ...framesAt(30, 10)])).toBeLessThan(40);
});
