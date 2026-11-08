import { Fn, exp, float, mix, mx_noise_float, uv, vec2, vec3, normalView, positionViewDirection, positionWorld, dot, pow, smoothstep, clamp } from 'three/tsl';
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshStandardNodeMaterial, PlaneGeometry, type NodeMaterial } from 'three/webgpu';
import { PIPES, TANK, type Vec3 } from './dimensions';
import { FLOOR_Y, INNER_X, INNER_Z } from './portals';
import { applyWaterLook } from '../water/volume';
import { applyPortalOptics } from './refractionNodes';
import { lightTint } from './lightColours';

const T = TANK.glassThickness;
const BEAD_RADIUS = 0.0035;
const PIPE_EXIT_METRES = 0.06;

/** Real glass reflects little head-on and a lot at glancing angles, with faint dust and scale. */
const createPaneMaterial = (): NodeMaterial => {
  const material = new MeshPhysicalNodeMaterial({ color: 0xf4faf6, metalness: 0, roughness: 0.04, transparent: true, depthWrite: false });
  const fresnel = Fn(() => {
    const facing = clamp(dot(normalView, positionViewDirection), 0, 1);
    return float(0.04).add(float(0.96).mul(pow(float(1).sub(facing), 5)));
  });
  const dust = smoothstep(0.45, 0.8, mx_noise_float(positionWorld.mul(38)).mul(0.5).add(0.5)).mul(0.012);
  const scaleLine = smoothstep(0.014, 0, positionWorld.y.sub(TANK.waterSurfaceY).abs()).mul(0.05);
  material.opacityNode = fresnel().add(dust).add(scaleLine);
  return material;
};

/** Cut glass edges glow green because light travels the length of the pane through iron-tinted glass. */
const createEdgeMaterial = (): NodeMaterial =>
  new MeshStandardNodeMaterial({ color: 0x1b3a30, metalness: 0, roughness: 0.2 });

/** BoxGeometry face order: +x, -x, +y, -y, +z, -z. Only the outward face of a pane is ever seen as glass. */
const FACE_INDEX = { '+x': 0, '-x': 1, '+z': 4, '-z': 5 } as const;
type OuterFace = keyof typeof FACE_INDEX;
const THICKNESS_AXIS_FACES: Readonly<Record<OuterFace, readonly number[]>> = { '+x': [0, 1], '-x': [0, 1], '+z': [4, 5], '-z': [4, 5] };
const HIDDEN = new MeshBasicNodeMaterial({ visible: false });

const pane = (size: Vec3, position: Vec3, paneMaterial: NodeMaterial, edgeMaterial: NodeMaterial, outerFace: OuterFace): Mesh => {
  const faces = [0, 1, 2, 3, 4, 5].map((index) => {
    if (index === FACE_INDEX[outerFace]) return paneMaterial;
    return THICKNESS_AXIS_FACES[outerFace].includes(index) ? HIDDEN : edgeMaterial;
  });
  const mesh = new Mesh(new BoxGeometry(...size), faces);
  mesh.position.set(...position);
  mesh.renderOrder = 2;
  return mesh;
};

const bead = (length: number, position: Vec3, rotation: Vec3, material: NodeMaterial): Mesh => {
  const mesh = new Mesh(new CylinderGeometry(BEAD_RADIUS, BEAD_RADIUS, length, 8), material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  return mesh;
};

/** The glass box, silicone seams, and pipes above the water. Everything outside the water that belongs to the tank. */
export const createTankShell = (): Group => {
  const shell = new Group();
  const glass = createPaneMaterial();
  const edge = createEdgeMaterial();
  const silicone = new MeshStandardNodeMaterial({ color: 0x0a0a0a, roughness: 0.35 });
  const midY = TANK.standTopY + TANK.height / 2;
  const { width: W, depth: D, height: H } = TANK;

  shell.add(pane([W, H, T], [0, midY, D / 2 - T / 2], glass, edge, '+z'));
  shell.add(pane([W, H, T], [0, midY, -D / 2 + T / 2], glass, edge, '-z'));
  shell.add(pane([T, H, D - 2 * T], [W / 2 - T / 2, midY, 0], glass, edge, '+x'));
  shell.add(pane([T, H, D - 2 * T], [-W / 2 + T / 2, midY, 0], glass, edge, '-x'));

  for (const [x, z] of [[INNER_X, INNER_Z], [-INNER_X, INNER_Z], [INNER_X, -INNER_Z], [-INNER_X, -INNER_Z]] as const) {
    shell.add(bead(H - T, [x, midY, z], [0, 0, 0], silicone));
  }

  // Equipment continues above the water, where it is not refracted.
  const plastic = new MeshStandardNodeMaterial({ color: 0x050505, roughness: 0.45 });
  for (const [x, z, radius] of PIPES) {
    const length = TANK.standTopY + H + PIPE_EXIT_METRES - TANK.waterSurfaceY;
    const pipe = new Mesh(new CylinderGeometry(radius, radius, length, 20), plastic);
    pipe.position.set(x, TANK.waterSurfaceY + length / 2, z);
    shell.add(pipe);
  }

  const airGapHeight = TANK.standTopY + H - TANK.waterSurfaceY;
  const airGapFilm = new Mesh(new BoxGeometry(INNER_X * 2, airGapHeight, 0.001), silicone);
  airGapFilm.position.set(0, TANK.waterSurfaceY + airGapHeight / 2, -INNER_Z);
  shell.add(airGapFilm);

  return shell;
};

/** A softly lit blue-teal background, brightest high on the left behind the bubbles, as in the reference. */
const createBackgroundMaterial = (): NodeMaterial => {
  const material = applyWaterLook(applyPortalOptics(new MeshBasicNodeMaterial()));
  const height = uv().y;
  const fromGlow = uv().sub(vec2(0.26, 0.92)).mul(vec2(4, 2.6));
  const glow = exp(fromGlow.dot(fromGlow).negate());
  const gradient = mix(vec3(0.01, 0.016, 0.012), vec3(0.14, 0.18, 0.225), height.pow(1.6));
  material.colorNode = gradient.add(vec3(0.72, 0.64, 0.66).mul(glow)).mul(mx_noise_float(uv().mul(5)).mul(0.08).add(1)).mul(lightTint);
  return material;
};

/** The parts seen through the water: the black backing film and the bottom glass. */
export const createTankInterior = (): Group => {
  const interior = new Group();
  // Tessellated because refraction moves vertices; one big quad would bend wrongly.
  const film = new Mesh(
    new PlaneGeometry(INNER_X * 2, TANK.waterSurfaceY - FLOOR_Y, 96, 40),
    createBackgroundMaterial(),
  );
  film.position.set(0, (TANK.waterSurfaceY + FLOOR_Y) / 2, -INNER_Z);
  const floor = new Mesh(
    new PlaneGeometry(INNER_X * 2, INNER_Z * 2, 128, 48),
    applyWaterLook(applyPortalOptics(new MeshStandardNodeMaterial({ color: 0x0a0a0a, roughness: 0.8 }))),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, FLOOR_Y, 0);
  interior.add(film, floor);
  return interior;
};
