import { PNG } from 'pngjs';

/** Pixel measurements on browser screenshots. Regions are in screenshot pixels. */
export type Image = { readonly width: number; readonly height: number; readonly data: Uint8Array };
export type Region = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
export type Point = { readonly x: number; readonly y: number };

export const decodePng = (buffer: Buffer): Image => {
  const png = PNG.sync.read(buffer);
  return { width: png.width, height: png.height, data: png.data };
};

/** Averages frames of the same size, which cancels out flicker from frame to frame. */
export const averagePixels = (frames: readonly Image[]): Image => {
  const [first] = frames;
  if (first === undefined) throw new Error('averagePixels needs at least one frame.');
  const data = new Uint8Array(first.data.length);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = Math.round(frames.reduce((sum, frame) => sum + (frame.data[index] ?? 0), 0) / frames.length);
  }
  return { width: first.width, height: first.height, data };
};

const pixelsIn = (image: Image, region: Region): readonly Point[] => {
  const left = Math.max(0, Math.floor(region.x));
  const top = Math.max(0, Math.floor(region.y));
  const right = Math.min(image.width, Math.ceil(region.x + region.width));
  const bottom = Math.min(image.height, Math.ceil(region.y + region.height));
  const points: Point[] = [];
  for (let y = top; y < bottom; y += 1) for (let x = left; x < right; x += 1) points.push({ x, y });
  return points;
};

const channel = (image: Image, { x, y }: Point, index: number): number => image.data[(y * image.width + x) * 4 + index] ?? 0;

/** Red clearly above the other channels; water's haze lifts green and blue a little. */
const isStronglyRed = (image: Image) => (point: Point): boolean =>
  channel(image, point, 0) > 120 && channel(image, point, 0) > channel(image, point, 1) + 55 && channel(image, point, 0) > channel(image, point, 2) + 55;

/** Centroid of strongly red pixels in a region, or null if there are none. */
export const redCentroidInRegion = (image: Image, region: Region): Point | null => {
  const reds = pixelsIn(image, region).filter(
    isStronglyRed(image),
  );
  if (reds.length === 0) return null;
  return {
    x: reds.reduce((sum, point) => sum + point.x, 0) / reds.length,
    y: reds.reduce((sum, point) => sum + point.y, 0) / reds.length,
  };
};

/** Mean absolute channel difference between two same-sized images, on the 0-255 scale. */
export const meanPixelDifference = (a: Image, b: Image, region: Region): number => {
  const points = pixelsIn(a, region);
  const total = points.reduce(
    (sum, point) =>
      sum +
      Math.abs(channel(a, point, 0) - channel(b, point, 0)) +
      Math.abs(channel(a, point, 1) - channel(b, point, 1)) +
      Math.abs(channel(a, point, 2) - channel(b, point, 2)),
    0,
  );
  return total / (points.length * 3);
};

/** Mean colour in a region as [r, g, b] on the 0-255 scale. */
export const meanColor = (image: Image, region: Region): readonly [number, number, number] => {
  const points = pixelsIn(image, region);
  const mean = (index: number): number => points.reduce((sum, point) => sum + channel(image, point, index), 0) / points.length;
  return [mean(0), mean(1), mean(2)];
};

/** Bounding box of strongly red pixels in a region, or null if there are none. */
export const redBoundingBox = (image: Image, region: Region): Region | null => {
  const reds = pixelsIn(image, region).filter(
    isStronglyRed(image),
  );
  if (reds.length === 0) return null;
  const xs = reds.map((point) => point.x);
  const ys = reds.map((point) => point.y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { x: left, y: top, width: Math.max(...xs) - left + 1, height: Math.max(...ys) - top + 1 };
};

const luminanceAt = (image: Image, point: Point): number =>
  0.2126 * channel(image, point, 0) + 0.7152 * channel(image, point, 1) + 0.0722 * channel(image, point, 2);

/** Sharpest brightness step between neighbouring pixels in a region, on the 0-255 scale. */
export const edgeSharpness = (image: Image, region: Region): number =>
  pixelsIn(image, region).reduce((sharpest, point) => {
    if (point.x + 1 >= image.width) return sharpest;
    return Math.max(sharpest, Math.abs(luminanceAt(image, point) - luminanceAt(image, { x: point.x + 1, y: point.y })));
  }, 0);

/** Share of a region's pixels that are almost pure black. */
export const shareOfBlack = (image: Image, region: Region): number => {
  const points = pixelsIn(image, region);
  const black = points.filter((point) => channel(image, point, 0) < 3 && channel(image, point, 1) < 3 && channel(image, point, 2) < 3);
  return black.length / points.length;
};

export const meanLuminance = (image: Image, region: Region): number => {
  const points = pixelsIn(image, region);
  return points.reduce((sum, point) => sum + luminanceAt(image, point), 0) / points.length;
};
