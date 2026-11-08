/** Real-world layout of the tank and shared geometric types. All lengths are metres. */

export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type Plane3 = { readonly normal: Vec3; readonly constant: number };

export const TANK = {
  width: 3.0,
  depth: 1.0,
  height: 1.35,
  glassThickness: 0.015,
  standTopY: 0.6,
  waterSurfaceY: 1.92,
  wallZ: -0.535,
  frontPaneZ: 0.5,
  iorWater: 1.333,
  iorGlass: 1.517,
} as const;

/** The living room's inner walls, and how close the camera may come to them. */
export const ROOM = { minX: -2.6, maxX: 2.6, maxZ: 5.3, ceilingY: 2.45, wallMargin: 0.2 } as const;

/** Air stone hidden behind the wood, feeding the bubble curtain. Matches tools/blender/aquascape_layout.py. */
export const AIR_STONE: Vec3 = [-0.72, 0.8, -0.38];

/** Equipment pipes that rise out of the water, as [x, z, radius]. Matches tools/blender/aquascape_layout.py. */
export const PIPES: readonly (readonly [number, number, number])[] = [[1.4, -0.41, 0.014], [1.28, -0.43, 0.015], [-1.4, -0.39, 0.014]];

/** Where the filter returns water, near the back left, just under the surface. */
export const FILTER_OUTLET: Vec3 = [-1.25, 1.86, -0.35];
