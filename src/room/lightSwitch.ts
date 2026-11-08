import { Raycaster, Vector2, type Box3, type Camera } from 'three/webgpu';

/** How far past the plate a click still counts, so a small switch across the room stays easy to hit. */
const HIT_MARGIN_METRES = 0.05;
/** Movement allowed between press and release before it counts as dragging the camera. */
const CLICK_TOLERANCE_PIXELS = 5;

/** Calls `onPress` when the wall switch is clicked, and shows a pointer over it. Drags that start on it still move the camera. */
export const watchLightSwitch = (canvas: HTMLCanvasElement, camera: Camera, bounds: Box3, onPress: () => void): void => {
  const target = bounds.clone().expandByScalar(HIT_MARGIN_METRES);
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const isOverSwitch = (event: PointerEvent): boolean => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, 1 - ((event.clientY - rect.top) / rect.height) * 2);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectsBox(target);
  };
  let pressedAt: Vector2 | null = null;
  canvas.addEventListener('pointerdown', (event: PointerEvent) => {
    pressedAt = isOverSwitch(event) ? new Vector2(event.clientX, event.clientY) : null;
  });
  canvas.addEventListener('pointerup', (event: PointerEvent) => {
    const isClick = pressedAt !== null && pressedAt.distanceTo(new Vector2(event.clientX, event.clientY)) <= CLICK_TOLERANCE_PIXELS;
    pressedAt = null;
    if (isClick && isOverSwitch(event)) onPress();
  });
  canvas.addEventListener('pointermove', (event: PointerEvent) => {
    if (event.buttons === 0) canvas.style.cursor = isOverSwitch(event) ? 'pointer' : '';
  });
};
