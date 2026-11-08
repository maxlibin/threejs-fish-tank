import { fract, mix, positionWorld, step, vec3 } from 'three/tsl';
import { Group, Mesh, MeshBasicNodeMaterial, PlaneGeometry, SphereGeometry } from 'three/webgpu';
import type { Vec3 } from '../../src/tank/dimensions';
import { applyPortalOptics } from '../../src/tank/refractionNodes';

/** A pure red sphere in the water, finely tessellated so refraction bends it smoothly. */
export const createOpticsMarker = (center: Vec3, radius: number): Mesh => {
  const marker = new Mesh(new SphereGeometry(radius, 48, 32), applyPortalOptics(new MeshBasicNodeMaterial({ color: 0xff0000 })));
  marker.position.set(...center);
  return marker;
};

const GRID_SEGMENTS = 96;

/** A bright checkered floor and coloured spheres, for judging refraction and mirror images by eye. */
export const createOpticsScene = (): Group => {
  const group = new Group();
  const checker = applyPortalOptics(new MeshBasicNodeMaterial());
  checker.colorNode = mix(vec3(0.05), vec3(0.9), step(0.5, fract(positionWorld.x.mul(10)).sub(0.5).mul(fract(positionWorld.z.mul(10)).sub(0.5)).sign().mul(0.5).add(0.5)));
  const floor = new Mesh(new PlaneGeometry(1.17, 0.42, GRID_SEGMENTS, GRID_SEGMENTS), checker);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.77, 0);
  group.add(floor);
  const colours: readonly (readonly [number, Vec3])[] = [
    [0xff3020, [-0.3, 1.0, 0]], [0x20d040, [0, 1.12, -0.1]], [0x3080ff, [0.3, 0.95, 0.08]], [0xffc020, [0.5, 1.15, -0.15]],
  ];
  for (const [colour, position] of colours) {
    const sphere = new Mesh(new SphereGeometry(0.05, 48, 32), applyPortalOptics(new MeshBasicNodeMaterial({ color: colour })));
    sphere.position.set(...position);
    group.add(sphere);
  }
  return group;
};
