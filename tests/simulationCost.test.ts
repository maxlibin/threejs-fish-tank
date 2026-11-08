import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseColliders } from '../src/aquascape/colliders';
import { createInitialState, createSimEnvironment, stepSimulation, type SimEnvironment } from '../src/fish/simulation';
import { POPULATION } from '../src/fish/species';

const FRAME_SECONDS = 1 / 60;
const FRAMES = 300;

test('stepping all the fish leaves most of a frame for drawing', () => {
  const { colliders, ground } = parseColliders(JSON.parse(readFileSync('public/assets/aquascape/colliders.json', 'utf8')) as object);
  const environment: SimEnvironment = createSimEnvironment(colliders, ground);
  let state = createInitialState(1, POPULATION, environment);
  const started = performance.now();
  for (let frame = 0; frame < FRAMES; frame += 1) state = stepSimulation(state, FRAME_SECONDS, environment);
  const millisecondsPerFrame = (performance.now() - started) / FRAMES;
  console.log(`colliders: ${colliders.length}, simulation: ${millisecondsPerFrame.toFixed(2)} ms per frame`);
  expect(millisecondsPerFrame).toBeLessThan(2);
});
