import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { InvalidColliderFileError, distanceToNearestSolid, parseColliders } from '../src/aquascape/colliders';

const environment = (): ReturnType<typeof parseColliders> =>
  parseColliders(JSON.parse(readFileSync('public/assets/aquascape/colliders.json', 'utf8')) as object);

describe('colliders', () => {
  test('a malformed file is rejected with a clear error', () => {
    expect(() => parseColliders({ colliders: [{ center: [0, 0] }], hardscapeSamples: [], ground: { heights: [] } })).toThrow(InvalidColliderFileError);
    expect(() => parseColliders({})).toThrow(InvalidColliderFileError);
  });

  test('the real file covers the composed hardscape', () => {
    const { colliders, hardscapeSamples } = environment();
    expect(colliders.length).toBeGreaterThan(20);
    for (const sample of hardscapeSamples) {
      expect(distanceToNearestSolid(sample, colliders)).toBeLessThanOrEqual(0);
    }
  });

  test('open water remains for fish to swim in', () => {
    const { colliders } = environment();
    // The clear space above the middle of the tank, as in the reference image.
    expect(distanceToNearestSolid([0.3, 1.72, 0.12], colliders)).toBeGreaterThan(0.05);
  });
});
