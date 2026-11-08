import type { PerspectiveCamera } from 'three';
import { ROOM, TANK, type Vec3 } from '../tank/dimensions';

export type ReviewView = 'wide-room' | 'front-tank' | 'side-glancing' | 'underside-surface' | 'angelfish-closeup';

/** Where the viewer stands: an orbit around a pivot that slides along the tank's width. */
export type OrbitPose = {
  readonly azimuthDegrees: number;
  readonly eyeHeight: number;
  /** Requested distance from the eye to the nearest point on the tank's outside. */
  readonly distanceToGlass: number;
  readonly pivotX: number;
};

export type CameraRig = {
  update(dt: number): void;
  jumpToView(view: ReviewView): void;
  jumpToPose(pose: OrbitPose): void;
  distanceToGlass(): number;
  azimuthDegrees(): number;
};

const LIMITS = {
  azimuthDegrees: 75,
  eyeHeightMin: 0.9,
  eyeHeightMax: 2.15,
  distanceMin: 0.25,
  distanceMax: 4.6,
  pivotX: 1.25,
} as const;

const LOOK_AT_Y = 1.26;
const DAMPING_PER_SECOND = 6;
const DRAG_DEGREES_PER_PIXEL = 0.12;
const DRAG_HEIGHT_PER_PIXEL = 0.0012;
const PAN_PER_PIXEL = 0.0012;
const WHEEL_ZOOM_PER_UNIT = 0.0012;

const REVIEW_POSES: Readonly<Record<ReviewView, OrbitPose>> = {
  'wide-room': { azimuthDegrees: 0, eyeHeight: 1.32, distanceToGlass: 4.4, pivotX: 0 },
  'front-tank': { azimuthDegrees: 0, eyeHeight: 1.26, distanceToGlass: 2.35, pivotX: 0 },
  'side-glancing': { azimuthDegrees: 52, eyeHeight: 1.3, distanceToGlass: 1.2, pivotX: 0 },
  'underside-surface': { azimuthDegrees: -8, eyeHeight: 1.2, distanceToGlass: 0.8, pivotX: 0 },
  'angelfish-closeup': { azimuthDegrees: 0, eyeHeight: 1.4, distanceToGlass: 0.25, pivotX: 0.08 },
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const clampRanges = (pose: OrbitPose): OrbitPose => ({
  azimuthDegrees: clamp(pose.azimuthDegrees, -LIMITS.azimuthDegrees, LIMITS.azimuthDegrees),
  eyeHeight: clamp(pose.eyeHeight, LIMITS.eyeHeightMin, LIMITS.eyeHeightMax),
  distanceToGlass: clamp(pose.distanceToGlass, LIMITS.distanceMin, LIMITS.distanceMax),
  pivotX: clamp(pose.pivotX, -LIMITS.pivotX, LIMITS.pivotX),
});

/** Distance from a point to the outside of the tank's glass box. */
export const distanceToTankBox = ([x, y, z]: Vec3): number => {
  const dx = Math.max(Math.abs(x) - TANK.width / 2, 0);
  const dy = Math.max(TANK.standTopY - y, y - (TANK.standTopY + TANK.height), 0);
  const dz = Math.max(Math.abs(z) - TANK.depth / 2, 0);
  return Math.hypot(dx, dy, dz);
};

const eyeAtRadius = (pose: OrbitPose, radius: number): Vec3 => {
  const azimuth = (pose.azimuthDegrees * Math.PI) / 180;
  return [pose.pivotX + radius * Math.sin(azimuth), pose.eyeHeight, radius * Math.cos(azimuth)];
};

const radiusAtDistance = (pose: OrbitPose, distance: number): number => {
  const search = (low: number, high: number, steps: number): number => {
    const middle = (low + high) / 2;
    if (steps === 0) return middle;
    return distanceToTankBox(eyeAtRadius(pose, middle)) < distance ? search(middle, high, steps - 1) : search(low, middle, steps - 1);
  };
  return search(0, LIMITS.distanceMax + TANK.width, 30);
};

const eyeAtGlassDistance = (pose: OrbitPose, distance: number): Vec3 => eyeAtRadius(pose, radiusAtDistance(pose, distance));

const isInsideRoom = ([x, , z]: Vec3): boolean =>
  x > ROOM.minX + ROOM.wallMargin && x < ROOM.maxX - ROOM.wallMargin && z < ROOM.maxZ - ROOM.wallMargin;

/** Finds the eye position at the requested glass distance, bisecting along the orbit radius, and keeps it inside the room. */
export const eyePosition = (pose: OrbitPose): Vec3 => {
  const largestRadiusInRoom = (low: number, high: number, steps: number): number => {
    const middle = (low + high) / 2;
    if (steps === 0) return low;
    return isInsideRoom(eyeAtRadius(pose, middle)) ? largestRadiusInRoom(middle, high, steps - 1) : largestRadiusInRoom(low, middle, steps - 1);
  };
  const wanted = radiusAtDistance(pose, pose.distanceToGlass);
  return eyeAtRadius(pose, Math.min(wanted, largestRadiusInRoom(0, LIMITS.distanceMax + TANK.width, 30)));
};

/** The tank nearly fills its wall, so near the ends the room leaves less space to swing around it. */
const fitAzimuthToRoom = (pose: OrbitPose): OrbitPose => {
  const closestFits = (azimuthDegrees: number): boolean => isInsideRoom(eyeAtGlassDistance({ ...pose, azimuthDegrees }, LIMITS.distanceMin));
  const largestShare = (low: number, high: number, steps: number): number => {
    const middle = (low + high) / 2;
    if (steps === 0) return low;
    return closestFits(pose.azimuthDegrees * middle) ? largestShare(middle, high, steps - 1) : largestShare(low, middle, steps - 1);
  };
  return closestFits(pose.azimuthDegrees) ? pose : { ...pose, azimuthDegrees: pose.azimuthDegrees * largestShare(0, 1, 14) };
};

export const clampPose = (pose: OrbitPose): OrbitPose => fitAzimuthToRoom(clampRanges(pose));

const dampPose = (current: OrbitPose, target: OrbitPose, dt: number): OrbitPose => {
  const blend = 1 - Math.exp(-DAMPING_PER_SECOND * dt);
  const step = (from: number, to: number): number => from + (to - from) * blend;
  return clampPose({
    azimuthDegrees: step(current.azimuthDegrees, target.azimuthDegrees),
    eyeHeight: step(current.eyeHeight, target.eyeHeight),
    distanceToGlass: step(current.distanceToGlass, target.distanceToGlass),
    pivotX: step(current.pivotX, target.pivotX),
  });
};

/**
 * A damped, limited orbit camera. Dragging orbits and raises the eye, shift-dragging slides along
 * the tank, and scrolling moves closer or farther. Closeness scales the input, so the camera stays
 * controllable at 25 cm.
 */
export const createCameraRig = (camera: PerspectiveCamera, canvas: HTMLCanvasElement): CameraRig => {
  let current = REVIEW_POSES['front-tank'];
  let target = current;

  const applyPose = (): void => {
    const [x, y, z] = eyePosition(current);
    camera.position.set(x, y, z);
    // Up close, look level rather than down at the tank's middle.
    const closeness = clamp(1 - current.distanceToGlass, 0, 1);
    camera.lookAt(current.pivotX, LOOK_AT_Y + (current.eyeHeight - LOOK_AT_Y) * closeness, 0);
  };

  canvas.addEventListener('pointerdown', (event: PointerEvent) => canvas.setPointerCapture(event.pointerId));
  canvas.addEventListener('pointermove', (event: PointerEvent) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    target = clampPose(
      event.shiftKey
        ? { ...target, pivotX: target.pivotX - event.movementX * PAN_PER_PIXEL }
        : {
            ...target,
            azimuthDegrees: target.azimuthDegrees - event.movementX * DRAG_DEGREES_PER_PIXEL,
            eyeHeight: target.eyeHeight + event.movementY * DRAG_HEIGHT_PER_PIXEL,
          },
    );
  });
  canvas.addEventListener(
    'wheel',
    (event: WheelEvent) => {
      event.preventDefault();
      const closenessScale = 0.25 + target.distanceToGlass;
      target = clampPose({
        ...target,
        distanceToGlass: target.distanceToGlass + event.deltaY * WHEEL_ZOOM_PER_UNIT * closenessScale,
      });
    },
    { passive: false },
  );

  const jumpToPose = (pose: OrbitPose): void => {
    current = clampPose(pose);
    target = current;
    applyPose();
  };

  applyPose();

  return {
    update: (dt: number): void => {
      current = dampPose(current, target, dt);
      applyPose();
    },
    jumpToView: (view: ReviewView): void => jumpToPose(REVIEW_POSES[view]),
    jumpToPose,
    distanceToGlass: (): number => distanceToTankBox([camera.position.x, camera.position.y, camera.position.z]),
    azimuthDegrees: (): number => current.azimuthDegrees,
  };
};
