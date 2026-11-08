import { BackSide, BoxGeometry, Mesh, MeshBasicNodeMaterial, PMREMGenerator, Scene, type Texture, type WebGPURenderer } from 'three/webgpu';
import { color, mix, positionLocal, smoothstep } from 'three/tsl';
import { lightTint } from '../tank/lightColours';

const ROOM_SIZE = 2;
const BLUR_SIGMA = 0.015;

export type UnderwaterEnvironment = {
  readonly texture: Texture;
  /** Redraws the reflections in place after the light colour changes, so no material has to be rebuilt. */
  refresh(): void;
};

/**
 * What a fish's silver flank reflects under water: the bright LED bar overhead, glowing water
 * around it, and light bouncing back up from the sand.
 */
export const createUnderwaterEnvironment = (renderer: WebGPURenderer): UnderwaterEnvironment => {
  const scene = new Scene();
  const material = new MeshBasicNodeMaterial({ side: BackSide });
  const height = positionLocal.y.div(ROOM_SIZE / 2);
  const below = color(0x8a7d62).mul(0.9);
  const middle = color(0x4c6f68).mul(0.85);
  const above = color(0xa9c6c0).mul(1.6);
  const walls = mix(below, middle, smoothstep(-0.7, -0.05, height));
  const ceiling = mix(walls, above, smoothstep(0.1, 0.65, height));
  // The light bar: a long, bright strip running the width of the tank.
  const barAcross = smoothstep(0.32, 0.12, positionLocal.z.abs()).mul(smoothstep(0.85, 0.5, positionLocal.x.abs()));
  const bar = barAcross.mul(smoothstep(0.8, 0.98, height)).mul(14);
  material.colorNode = ceiling.add(bar).mul(lightTint);
  scene.add(new Mesh(new BoxGeometry(ROOM_SIZE, ROOM_SIZE, ROOM_SIZE), material));
  const generator = new PMREMGenerator(renderer);
  const target = generator.fromScene(scene, BLUR_SIGMA);
  return {
    texture: target.texture,
    refresh: (): void => {
      generator.fromScene(scene, BLUR_SIGMA, 0.1, 100, { renderTarget: target });
    },
  };
};
