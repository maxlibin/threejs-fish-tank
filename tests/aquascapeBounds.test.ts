import { NodeIO } from '@gltf-transform/core';
import { describe, expect, test } from 'vitest';
import { TANK } from '../src/tank/dimensions';

const INNER = {
  x: TANK.width / 2 - TANK.glassThickness,
  z: TANK.frontPaneZ - TANK.glassThickness,
  floor: TANK.standTopY + TANK.glassThickness,
  surface: TANK.waterSurfaceY,
};
// Pipes rise out of the water on purpose; everything else stays inside the glass.
const ALLOWED_ABOVE_SURFACE = new Set(['filter_intake', 'heater', 'filter_return']);
const TOLERANCE = 0.001;

type Overrun = { readonly mesh: string; readonly axis: string; readonly metres: number };

const findOverruns = async (file: string): Promise<readonly Overrun[]> => {
  const document = await new NodeIO().read(`public/assets/aquascape/${file}`);
  return document.getRoot().listNodes().flatMap((node) => {
    const mesh = node.getMesh();
    if (mesh === null) return [];
    const matrix = node.getWorldMatrix();
    const name = node.getName();
    return mesh.listPrimitives().flatMap((primitive): readonly Overrun[] => {
      const positions = primitive.getAttribute('POSITION');
      if (positions === null) return [];
      const worst = { x: 0, z: 0, up: 0, down: 0 };
      for (let index = 0; index < positions.getCount(); index += 1) {
        const [px, py, pz] = positions.getElement(index, [0, 0, 0]) as [number, number, number];
        const x = matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12];
        const y = matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13];
        const z = matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14];
        worst.x = Math.max(worst.x, Math.abs(x) - INNER.x);
        worst.z = Math.max(worst.z, Math.abs(z) - INNER.z);
        worst.up = Math.max(worst.up, y - INNER.surface);
        worst.down = Math.max(worst.down, INNER.floor - y);
      }
      const overruns: Overrun[] = [
        { mesh: name, axis: 'sides', metres: worst.x },
        { mesh: name, axis: 'front or back', metres: worst.z },
        { mesh: name, axis: 'floor', metres: worst.down },
        ...(ALLOWED_ABOVE_SURFACE.has(name) ? [] : [{ mesh: name, axis: 'surface', metres: worst.up }]),
      ];
      return overruns.filter(({ metres }) => metres > TOLERANCE).map((overrun) => ({ ...overrun, metres: Math.round(overrun.metres * 1000) / 1000 }));
    });
  });
};

describe('everything in the tank stays inside the glass', () => {
  test.each(['hardscape.glb', 'plants.glb', 'plantscans.glb'])('%s', async (file) => {
    expect(await findOverruns(file)).toEqual([]);
  });
});
