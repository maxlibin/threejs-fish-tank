import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';

type FishContract = { readonly file: string; readonly minLength: number; readonly maxLength: number; readonly maxTriangles: number; readonly mapSize: number };

const pngSize = (path: string): number => PNG.sync.read(readFileSync(path)).width;

const describeFishAsset = ({ file, minLength, maxLength, maxTriangles, mapSize }: FishContract): void => {
  describe(file, () => {
    test('meets the asset contract', async () => {
      const document = await new NodeIO().read(`public/assets/fish/${file}.glb`);
      const meshes = document.getRoot().listMeshes();
      expect(meshes.map((mesh) => mesh.getName())).toEqual(expect.arrayContaining(['body', 'eye']));
      const body = meshes.find((mesh) => mesh.getName() === 'body');
      const primitive = body?.listPrimitives()[0];
      const positions = primitive?.getAttribute('POSITION');
      const colors = primitive?.getAttribute('COLOR_0');
      const indices = primitive?.getIndices();
      if (positions == null || colors == null || indices == null) throw new Error(`${file}: body needs POSITION, COLOR_0, and indices.`);
      const length = (positions.getMax([0, 0, 0])[0] ?? 0) - (positions.getMin([0, 0, 0])[0] ?? 0);
      expect(length).toBeGreaterThanOrEqual(minLength);
      expect(length).toBeLessThanOrEqual(maxLength);
      // Spine position runs from 0 at the nose to 1 at the tail tip.
      const colorScale = colors.getNormalized() ? 2 ** (8 * colors.getComponentSize()) - 1 : 1;
      expect((colors.getMax([0, 0, 0, 0])[0] ?? 0) / colorScale).toBeCloseTo(1, 2);
      expect((colors.getMin([0, 0, 0, 0])[0] ?? 0) / colorScale).toBeCloseTo(0, 2);
      expect(indices.getCount() / 3).toBeLessThanOrEqual(maxTriangles);
      for (const map of ['baseColor', 'normal', 'material']) {
        expect(pngSize(`public/assets/fish/${file}/${map}.png`)).toBe(mapSize);
      }
    });
  });
};

describeFishAsset({ file: 'angelfish', minLength: 0.18, maxLength: 0.22, maxTriangles: 90_000, mapSize: 4096 });
describeFishAsset({ file: 'angelfish_gold', minLength: 0.18, maxLength: 0.22, maxTriangles: 90_000, mapSize: 4096 });
describeFishAsset({ file: 'cardinal_tetra', minLength: 0.075, maxLength: 0.095, maxTriangles: 20_000, mapSize: 2048 });
describeFishAsset({ file: 'cardinal_tetra_2', minLength: 0.075, maxLength: 0.095, maxTriangles: 20_000, mapSize: 2048 });
describeFishAsset({ file: 'cardinal_tetra_3', minLength: 0.075, maxLength: 0.095, maxTriangles: 20_000, mapSize: 2048 });
describeFishAsset({ file: 'angelfish_platinum', minLength: 0.18, maxLength: 0.22, maxTriangles: 90_000, mapSize: 2048 });
describeFishAsset({ file: 'angelfish_blue', minLength: 0.18, maxLength: 0.22, maxTriangles: 90_000, mapSize: 2048 });
describeFishAsset({ file: 'angelfish_koi', minLength: 0.18, maxLength: 0.22, maxTriangles: 90_000, mapSize: 2048 });
describeFishAsset({ file: 'discus', minLength: 0.18, maxLength: 0.22, maxTriangles: 40_000, mapSize: 2048 });
describeFishAsset({ file: 'dwarf_gourami', minLength: 0.105, maxLength: 0.135, maxTriangles: 30_000, mapSize: 2048 });
describeFishAsset({ file: 'tiger_barb', minLength: 0.08, maxLength: 0.1, maxTriangles: 20_000, mapSize: 2048 });
describeFishAsset({ file: 'platy', minLength: 0.075, maxLength: 0.095, maxTriangles: 20_000, mapSize: 2048 });
describeFishAsset({ file: 'corydoras', minLength: 0.065, maxLength: 0.085, maxTriangles: 20_000, mapSize: 2048 });
describeFishAsset({ file: 'otocinclus', minLength: 0.045, maxLength: 0.065, maxTriangles: 16_000, mapSize: 2048 });
