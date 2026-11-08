import type { Object3D } from 'three/webgpu';
import type { CameraRig, OrbitPose, ReviewView } from '../camera/cameraRig';
import type { Vec2, Vec3 } from '../tank/dimensions';
import type { SurfaceStats } from '../water/surface';
import type { FrameStats } from './frameStats';

/** Development-only hooks that let the browser tests drive the running app. */
export type TankDebugApi = {
  setView(view: ReviewView): void;
  setPose(pose: OrbitPose): void;
  eye(): Vec3;
  projectToScreen(world: Vec3): Vec2;
  addToContents(object: Object3D): void;
  jumpTimeTo(seconds: number): void;
  largestTimeUniform(): number;
  fishPositions(): readonly Vec3[];
  setFocusDistance(metres: number): void;
  surfaceStats(): Promise<SurfaceStats>;
  freezeAt(seconds: number): void;
  frameStats(): FrameStats;
  resetFrameStats(): void;
  /** Geometry drawn in the most recent frame, which other programs using the GPU cannot affect. */
  drawnLastFrame(): { readonly triangles: number; readonly drawCalls: number };
  /** Starts leaves shaking at a point, as if a fish had just pushed through them. */
  shakeLeavesAt(position: Vec3): void;
  plantBumpCount(): number;
  loseDevice(): void;
  distanceToGlass(): number;
  azimuthDegrees(): number;
  /** Which of the tank light's colours is on; 0 is the white the scene was tuned under. */
  lightColourIndex(): number;
  lightSwitchCentre(): Vec3;
};

declare global {
  interface Window {
    __tank: TankDebugApi;
  }
}

