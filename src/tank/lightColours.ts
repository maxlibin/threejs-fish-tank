import { uniform } from 'three/tsl';
import { Color } from 'three/webgpu';

type Rgb = readonly [number, number, number];

/** The white the whole scene was tuned under, in linear RGB. */
export const TUNED_WHITE: Rgb = [1, 0.965, 0.9];

/**
 * The settings of a colour-changing aquarium LED, in linear RGB, in the order the wall switch steps
 * through them. Most are about as bright as the white; purple and blue read dimmer, and moonlight is a night setting.
 */
export const LIGHT_COLOURS: readonly { readonly name: string; readonly rgb: Rgb }[] = [
  { name: 'Daylight', rgb: TUNED_WHITE },
  { name: 'Sunrise', rgb: [1.25, 0.9, 0.5] },
  { name: 'Sunset', rgb: [1.6, 0.7, 0.35] },
  { name: 'Pink', rgb: [1.35, 0.8, 1.15] },
  { name: 'Purple', rgb: [0.95, 0.55, 1.6] },
  { name: 'Ocean blue', rgb: [0.35, 0.8, 1.6] },
  { name: 'Tropical', rgb: [0.45, 1.05, 0.95] },
  { name: 'Moonlight', rgb: [0.1, 0.17, 0.4] },
];

/** The current light relative to the tuned white. Everything the tank light reaches multiplies by it, so the default changes nothing. */
export const lightTint = uniform(new Color(1, 1, 1));

export const nextLightColour = (index: number): number => (index + 1) % LIGHT_COLOURS.length;

/** The light colour at `index`, relative to the tuned white. */
export const tintOf = (index: number): Rgb => {
  const setting = LIGHT_COLOURS[index];
  if (setting === undefined) throw new Error(`No light colour at index ${index}; there are ${LIGHT_COLOURS.length}.`);
  return [setting.rgb[0] / TUNED_WHITE[0], setting.rgb[1] / TUNED_WHITE[1], setting.rgb[2] / TUNED_WHITE[2]];
};
