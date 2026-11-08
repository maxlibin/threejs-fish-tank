import { AlwaysDepth, BoxGeometry, Matrix4, Mesh, MeshBasicNodeMaterial, Scene, Vector4, type Camera, type Object3D, type WebGPURenderer } from 'three/webgpu';
import { cameraProjectionMatrix, modelViewMatrix, positionLocal, vec4 } from 'three/tsl';
import { apparentPosition } from './refraction';
import { TANK, type Plane3, type Vec3 } from './dimensions';
import { MAX_CLIP_PLANES, clipPlaneValues, portalUniforms } from './refractionNodes';

export type PortalId = 'front' | 'side' | 'top' | 'surface-mirror' | 'side-mirror';

/**
 * One view into the water. `plane` is the interface the light crosses. `corners` outline what is
 * seen, in true positions. When `mirror` is set, the view is of a total-internal-reflection image,
 * and `secondMirror` adds a second bounce, as in the top corners, where side pane and surface both reflect.
 */
export type Portal = {
  readonly id: PortalId;
  readonly plane: Plane3;
  readonly entryCorners: readonly Vec3[];
  readonly corners: readonly Vec3[];
  readonly mirror: Plane3 | null;
  readonly secondMirror: Plane3 | null;
};

export type PortalRenderContext = {
  readonly renderer: WebGPURenderer;
  readonly contents: Scene;
  readonly camera: Camera;
  /** Fine detail left out of every reflection, where it cannot be made out. */
  readonly directViewsOnly: readonly Object3D[];
  /** Left out of the faint reflection in the water's surface too, and of double reflections. */
  readonly clearReflectionsOnly: readonly Object3D[];
};

export const INNER_X = TANK.width / 2 - TANK.glassThickness;
export const INNER_Z = TANK.depth / 2 - TANK.glassThickness;
export const FLOOR_Y = TANK.standTopY + TANK.glassThickness;
const SURFACE_Y = TANK.waterSurfaceY;

export const FRONT_PLANE: Plane3 = { normal: [0, 0, 1], constant: -INNER_Z };
const RIGHT_PLANE: Plane3 = { normal: [1, 0, 0], constant: -INNER_X };
const LEFT_PLANE: Plane3 = { normal: [-1, 0, 0], constant: -INNER_X };
const TOP_PLANE: Plane3 = { normal: [0, 1, 0], constant: -SURFACE_Y };

const FRONT_RECT: readonly Vec3[] = [
  [-INNER_X, FLOOR_Y, INNER_Z], [INNER_X, FLOOR_Y, INNER_Z], [INNER_X, SURFACE_Y, INNER_Z], [-INNER_X, SURFACE_Y, INNER_Z],
];
const sideRect = (x: number): readonly Vec3[] => [
  [x, FLOOR_Y, INNER_Z], [x, FLOOR_Y, -INNER_Z], [x, SURFACE_Y, -INNER_Z], [x, SURFACE_Y, INNER_Z],
];
const RIGHT_RECT = sideRect(INNER_X);
const LEFT_RECT = sideRect(-INNER_X);
const TOP_RECT: readonly Vec3[] = [
  [-INNER_X, SURFACE_Y, INNER_Z], [INNER_X, SURFACE_Y, INNER_Z], [INNER_X, SURFACE_Y, -INNER_Z], [-INNER_X, SURFACE_Y, -INNER_Z],
];

const SURFACE_MIRROR_STRENGTH = 0.2;
const SURFACE_WOBBLE: Readonly<Record<PortalId, number>> = { front: 0, side: 0, top: 0.25, 'surface-mirror': 3.2, 'side-mirror': 0 };

const directPortal = (id: PortalId, plane: Plane3, rect: readonly Vec3[]): Portal => ({
  id, plane, entryCorners: rect, corners: rect, mirror: null, secondMirror: null,
});

const mirrorPortal = (id: PortalId, entry: Portal, mirror: Plane3, rect: readonly Vec3[]): Portal => ({
  id, plane: entry.plane, entryCorners: entry.entryCorners, corners: rect, mirror, secondMirror: null,
});

const DOUBLE_MIRROR_REACH = 3;

/**
 * Seen through a pane, light that bounced off both the surface and a neighbouring pane, in either
 * order. Unfolded, every such ray ends beyond both mirrors on the image of the back of the tank,
 * so that open-ended rectangle is the outline.
 */
const doubleMirrorPortal = (entry: Portal, pane: Plane3, paneX: number): Portal => ({
  id: 'surface-mirror',
  plane: entry.plane,
  entryCorners: entry.entryCorners,
  corners: [
    [paneX, SURFACE_Y, -INNER_Z],
    [paneX + Math.sign(paneX) * DOUBLE_MIRROR_REACH, SURFACE_Y, -INNER_Z],
    [paneX + Math.sign(paneX) * DOUBLE_MIRROR_REACH, SURFACE_Y + DOUBLE_MIRROR_REACH, -INNER_Z],
    [paneX, SURFACE_Y + DOUBLE_MIRROR_REACH, -INNER_Z],
  ],
  mirror: TOP_PLANE,
  secondMirror: pane,
});

/** The portals an eye outside the tank can see, including mirror images behind each pane. */
export const visiblePortals = ([x, y, z]: Vec3): readonly Portal[] => {
  const seesFront = z > INNER_Z;
  const seesRight = x > INNER_X;
  const seesLeft = x < -INNER_X;
  const belowSurface = y < SURFACE_Y;
  const front = directPortal('front', FRONT_PLANE, FRONT_RECT);
  const right = directPortal('side', RIGHT_PLANE, RIGHT_RECT);
  const left = directPortal('side', LEFT_PLANE, LEFT_RECT);

  const frontViews: readonly Portal[] = seesFront
    ? [
        front,
        ...(seesRight ? [] : [mirrorPortal('side-mirror', front, RIGHT_PLANE, RIGHT_RECT)]),
        ...(seesLeft ? [] : [mirrorPortal('side-mirror', front, LEFT_PLANE, LEFT_RECT)]),
        ...(belowSurface ? [mirrorPortal('surface-mirror', front, TOP_PLANE, TOP_RECT)] : []),
        ...(belowSurface && !seesRight ? [doubleMirrorPortal(front, RIGHT_PLANE, INNER_X)] : []),
        ...(belowSurface && !seesLeft ? [doubleMirrorPortal(front, LEFT_PLANE, -INNER_X)] : []),
      ]
    : [];
  const sideViews = (entry: Portal): readonly Portal[] => [
    entry,
    ...(seesFront ? [mirrorPortal('side-mirror', entry, FRONT_PLANE, FRONT_RECT)] : []),
    ...(belowSurface ? [mirrorPortal('surface-mirror', entry, TOP_PLANE, TOP_RECT)] : []),
  ];

  return [
    ...frontViews,
    ...(seesRight ? sideViews(right) : []),
    ...(seesLeft ? sideViews(left) : []),
    ...(belowSurface ? [] : [directPortal('top', TOP_PLANE, TOP_RECT)]),
  ];
};

const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** The side planes of the pyramid from the eye through a polygon, each as [normal, constant] with inside positive. */
const pyramidPlanes = (eye: Vec3, polygon: readonly Vec3[]): readonly (readonly [number, number, number, number])[] => {
  const count = polygon.length;
  const centre = polygon.reduce<Vec3>((sum, corner) => [sum[0] + corner[0] / count, sum[1] + corner[1] / count, sum[2] + corner[2] / count], [0, 0, 0]);
  return polygon.map((corner, index) => {
    const next = polygon[(index + 1) % count] as Vec3;
    const raw = cross(sub(corner, eye), sub(next, eye));
    const size = Math.hypot(raw[0], raw[1], raw[2]);
    const normal: Vec3 = [raw[0] / size, raw[1] / size, raw[2] / size];
    const constant = -dot(normal, eye);
    const sign = dot(normal, centre) + constant >= 0 ? 1 : -1;
    return [normal[0] * sign, normal[1] * sign, normal[2] * sign, constant * sign] as const;
  });
};

const setActivePortal = (portal: Portal, eye: Vec3): void => {
  const uniforms = portalUniforms;
  uniforms.planeNormal.value.set(...portal.plane.normal);
  uniforms.planeConstant.value = portal.plane.constant;
  if (portal.mirror === null) {
    uniforms.mirrorNormal.value.set(0, 0, 0);
    uniforms.mirrorConstant.value = 0;
  } else {
    uniforms.mirrorNormal.value.set(...portal.mirror.normal);
    uniforms.mirrorConstant.value = portal.mirror.constant;
  }
  if (portal.secondMirror === null) {
    uniforms.secondMirrorNormal.value.set(0, 0, 0);
    uniforms.secondMirrorConstant.value = 0;
  } else {
    uniforms.secondMirrorNormal.value.set(...portal.secondMirror.normal);
    uniforms.secondMirrorConstant.value = portal.secondMirror.constant;
  }
  uniforms.normalSign.value = portal.mirror === null ? 1 : portal.secondMirror === null ? -1 : 1;
  uniforms.surfaceWobble.value = SURFACE_WOBBLE[portal.id];
  uniforms.mirrorStrength.value = portal.id === 'surface-mirror' ? SURFACE_MIRROR_STRENGTH : 1;

  const visibleOutline = portal.corners.map((corner) => apparentPosition(eye, corner, portal.plane, TANK.iorWater));
  const planes = [...pyramidPlanes(eye, portal.entryCorners), ...pyramidPlanes(eye, visibleOutline)];
  if (planes.length > MAX_CLIP_PLANES) throw new Error(`Portal ${portal.id} needs ${planes.length} clip planes; the limit is ${MAX_CLIP_PLANES}.`);
  clipPlaneValues.forEach((target, index) => {
    const plane = planes[index];
    if (plane === undefined) target.set(0, 0, 0, 1);
    else target.set(...plane);
  });
};

/**
 * Clears depth inside the water box. Refracted and mirrored images can lie deeper than the wall
 * behind the tank, and would otherwise fail the depth test against it.
 */
export const createDepthPunch = (): Scene => {
  const material = new MeshBasicNodeMaterial({ colorWrite: false, depthFunc: AlwaysDepth });
  material.vertexNode = cameraProjectionMatrix.mul(modelViewMatrix).mul(vec4(positionLocal, 1)).toVar().xyww;
  const box = new Mesh(new BoxGeometry(INNER_X * 2, SURFACE_Y - FLOOR_Y, INNER_Z * 2), material);
  box.position.set(0, (SURFACE_Y + FLOOR_Y) / 2, 0);
  const scene = new Scene();
  scene.add(box);
  return scene;
};

/** Whether any of a portal could reach the screen; if all its corners lie beyond one edge, none of it can. */
const isPortalOnScreen = (portal: Portal, eye: Vec3, viewProjection: Matrix4): boolean => {
  const clip = [...portal.entryCorners, ...portal.corners.map((corner) => apparentPosition(eye, corner, portal.plane, TANK.iorWater))].map(([x, y, z]) =>
    new Vector4(x, y, z, 1).applyMatrix4(viewProjection),
  );
  const entryCount = portal.entryCorners.length;
  const beyond = (points: readonly Vector4[], test: (point: Vector4) => boolean): boolean => points.every(test);
  const offScreen = (points: readonly Vector4[]): boolean =>
    beyond(points, (p) => p.x < -p.w) || beyond(points, (p) => p.x > p.w) || beyond(points, (p) => p.y < -p.w) || beyond(points, (p) => p.y > p.w);
  return !offScreen(clip.slice(0, entryCount)) && !offScreen(clip.slice(entryCount));
};

/** Draws the tank's contents once per visible portal. Clears nothing; the caller owns the target. */
export const renderPortals = ({ renderer, contents, camera, directViewsOnly, clearReflectionsOnly }: PortalRenderContext): void => {
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const viewProjection = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const portals = visiblePortals(eye);
  // Looking through two panes at once, the direct views fill the frame and reflections matter little.
  const seesTwoPanes = portals.filter((portal) => portal.mirror === null && portal.id !== 'top').length > 1;
  for (const portal of portals) {
    if (!isPortalOnScreen(portal, eye, viewProjection)) continue;
    setActivePortal(portal, eye);
    for (const object of directViewsOnly) object.visible = portal.mirror === null;
    for (const object of clearReflectionsOnly) object.visible = portal.mirror === null || (portal.id !== 'surface-mirror' && !seesTwoPanes);
    renderer.render(contents, camera);
  }
};
