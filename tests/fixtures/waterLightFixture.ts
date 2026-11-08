import { Group, Mesh, MeshBasicNodeMaterial, MeshStandardNodeMaterial, PlaneGeometry, SphereGeometry } from 'three/webgpu';
import type { Vec3 } from '../../src/tank/dimensions';
import { applyPortalOptics } from '../../src/tank/refractionNodes';
import { applyWaterLook } from '../../src/water/volume';

const submerged = (color: number): MeshStandardNodeMaterial =>
  applyWaterLook(applyPortalOptics(new MeshStandardNodeMaterial({ color, roughness: 0.9 })));

/** A pale sand floor, plus two white spheres at different distances from the front glass. */
export const createWaterLightScene = (near: Vec3, far: Vec3): Group => {
  const group = new Group();
  const sand = new Mesh(new PlaneGeometry(2.94, 0.66, 120, 32), submerged(0xcbbfa6));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.7, 0);
  sand.receiveShadow = true;
  group.add(sand);
  for (const position of [near, far]) {
    // Unlit, so colour differences come only from the water between sphere and eye.
    const sphere = new Mesh(new SphereGeometry(0.03, 48, 32), applyWaterLook(applyPortalOptics(new MeshBasicNodeMaterial({ color: 0xb0b0b0 }))));
    sphere.position.set(...position);
    sphere.castShadow = true;
    group.add(sphere);
  }
  return group;
};
