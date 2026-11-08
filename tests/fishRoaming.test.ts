import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { distanceToNearestSolid, groundHeightAt, parseColliders, type Collider } from '../src/aquascape/colliders';
import { createInitialState, createSimEnvironment, stepSimulation } from '../src/fish/simulation';
import { POPULATION } from '../src/fish/species';
import type { Vec3 } from '../src/tank/dimensions';

const FRAME_SECONDS = 1 / 60;
const SECONDS = 300;
const EYE: Vec3 = [0, 1.25, 3.2];
/** A solid hides a fish only when it clearly covers the sight line, not when the line grazes its edge. */
const COVER_SHARE = 0.7;
const NEAR_COVER_METRES = 0.3;

const isHiddenFromViewer = (position: Vec3, solids: readonly Collider[]): boolean => {
  const line: Vec3 = [position[0] - EYE[0], position[1] - EYE[1], position[2] - EYE[2]];
  const lengthSquared = line[0] * line[0] + line[1] * line[1] + line[2] * line[2];
  return solids.some(({ center, radius }) => {
    const along = ((center[0] - EYE[0]) * line[0] + (center[1] - EYE[1]) * line[1] + (center[2] - EYE[2]) * line[2]) / lengthSquared;
    if (along <= 0 || along >= 1) return false;
    const gap = Math.hypot(EYE[0] + line[0] * along - center[0], EYE[1] + line[1] * along - center[1], EYE[2] + line[2] * along - center[2]);
    return gap < radius * COVER_SHARE;
  });
};

const spread = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return (sorted[Math.floor(sorted.length * 0.9)] ?? 0) - (sorted[Math.floor(sorted.length * 0.1)] ?? 0);
};

type Roaming = {
  readonly xs: readonly number[];
  readonly heights: readonly number[];
  readonly depths: readonly number[];
  readonly hiddenShare: number;
  readonly acrossTankMotionShare: number;
  readonly tetraSpeeds: readonly number[];
  readonly restShare: number;
  readonly restNearCoverShare: number;
};

const recordRoaming = (): Roaming => {
  const { colliders, ground } = parseColliders(JSON.parse(readFileSync('public/assets/aquascape/colliders.json', 'utf8')) as object);
  const environment = createSimEnvironment(colliders, ground);
  const xs: number[] = [];
  const heights: number[] = [];
  const depths: number[] = [];
  const tetraSpeeds: number[] = [];
  let hidden = 0;
  let samples = 0;
  let acrossTank = 0;
  let travelled = 0;
  let resting = 0;
  let restingNearCover = 0;
  let state = createInitialState(1, POPULATION, environment);
  for (let frame = 0; frame < SECONDS / FRAME_SECONDS; frame += 1) {
    state = stepSimulation(state, FRAME_SECONDS, environment);
    if (frame % 60 !== 0) continue;
    for (const fish of state.fish) {
      if (fish.species === 'corydoras' || fish.species === 'otocinclus') continue;
      xs.push(fish.position[0]);
      heights.push(fish.position[1]);
      depths.push(fish.position[2]);
      samples += 1;
      if (isHiddenFromViewer(fish.position, colliders)) hidden += 1;
      const speed = Math.hypot(...fish.velocity);
      if (fish.species === 'cardinalTetra') tetraSpeeds.push(speed);
      if (fish.mode === 'rest') {
        resting += 1;
        const nearSolid = distanceToNearestSolid(fish.position, colliders) < NEAR_COVER_METRES;
        const nearGround = fish.position[1] - groundHeightAt(fish.position[0], fish.position[2], ground) < NEAR_COVER_METRES;
        if (nearSolid || nearGround) restingNearCover += 1;
      } else {
        acrossTank += Math.abs(fish.velocity[2]);
        travelled += speed;
      }
    }
  }
  return { xs, heights, depths, hiddenShare: hidden / samples, acrossTankMotionShare: acrossTank / travelled, tetraSpeeds, restShare: resting / samples, restNearCoverShare: restingNearCover / Math.max(resting, 1) };
};

const shareBetween = (values: readonly number[], low: number, high: number): number => values.filter((value) => value >= low && value < high).length / values.length;
const percentile = (values: readonly number[], share: number): number => [...values].sort((a, b) => a - b)[Math.floor(values.length * share)] ?? 0;

describe('mid-water fish over five simulated minutes in the real tank', () => {
  const run = recordRoaming();

  test('they use most of the height of the water', () => {
    expect(spread(run.heights)).toBeGreaterThan(0.5);
  });

  test('they use most of the depth of the tank', () => {
    expect(spread(run.depths)).toBeGreaterThan(0.3);
  });

  test('they spend real time hidden behind the wood and plants', () => {
    expect(run.hiddenShare).toBeGreaterThan(0.08);
  });

  test('they spread along the tank rather than crowding the middle', () => {
    expect(shareBetween(run.xs, -1.5, -0.5)).toBeGreaterThan(0.2);
    expect(shareBetween(run.xs, -0.5, 0.5)).toBeLessThan(0.55);
    expect(shareBetween(run.xs, 0.5, 1.5)).toBeGreaterThan(0.2);
  });

  test('much of their travel is toward or away from the viewer', () => {
    expect(run.acrossTankMotionShare).toBeGreaterThan(0.3);
  });

  test('tetras cruise at about one body length a second', () => {
    expect(percentile(run.tetraSpeeds, 0.5)).toBeLessThan(0.1);
  });

  test('speed varies, with bursts and glides rather than a constant pace', () => {
    expect(percentile(run.tetraSpeeds, 0.9) / Math.max(percentile(run.tetraSpeeds, 0.1), 0.001)).toBeGreaterThan(2.5);
  });

  test('they rest a good part of the time', () => {
    expect(run.restShare).toBeGreaterThan(0.15);
  });

  test('they rest near cover, not out in open water', () => {
    expect(run.restNearCoverShare).toBeGreaterThan(0.7);
  });
});
