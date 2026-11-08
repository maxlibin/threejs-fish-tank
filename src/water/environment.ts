import { BackSide, BoxGeometry, Mesh, MeshBasicNodeMaterial, PMREMGenerator, Scene, type Texture, type WebGPURenderer } from 'three/webgpu';
import { color, mix, positionLocal, smoothstep } from 'three/tsl';

const ROOM_SIZE = 2;
const BLUR_SIGMA = 0.015;

/**
 * What a fish's silver flank reflects under water: the bright LED bar overhead, glowing water
 * around it, and light bouncing back up from the sand.
 */
export const createUnderwaterEnvironment = async (renderer: WebGPURenderer): Promise<Texture> => {
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
  material.colorNode = ceiling.add(bar);
  scene.add(new Mesh(new BoxGeometry(ROOM_SIZE, ROOM_SIZE, ROOM_SIZE), material));
  const generator = new PMREMGenerator(renderer);
  const target = await generator.fromSceneAsync(scene, BLUR_SIGMA);
  generator.dispose();
  return target.texture;
};
