export type SpeciesId = 'angelfish' | 'discus' | 'dwarfGourami' | 'cardinalTetra' | 'tigerBarb' | 'platy' | 'corydoras' | 'otocinclus';

/** How a fish lives: in a school, drifting alone in mid-water, rooting on the bottom, or grazing on the glass. */
export type FishHabit = 'school' | 'drift' | 'root' | 'graze';

export type SpeciesParams = {
  /** Skins for this species, handed out evenly so that a group is not all copies of one fish. */
  readonly assetNames: readonly string[];
  /** Total length in metres, nose to tail tip. */
  readonly bodyLength: number;
  readonly maxSpeed: number;
  /** Tail beats per second at full swimming amplitude. */
  readonly swimFrequency: number;
  /** Body waves between nose and tail. */
  readonly bodyWaves: number;
  readonly finFlexStrength: number;
  readonly pectoralStrength: number;
  readonly habit: FishHabit;
  /** Comfortable swimming speed in metres per second. */
  readonly cruiseSpeed: number;
  /** The share of the water's height this fish prefers, from low to high. */
  readonly heightShares: readonly [number, number];
  /** Which schools fish of this species join in turn; a repeated number makes that school larger. */
  readonly schools: readonly number[];
};

const ANGELFISH_BODY = { bodyLength: 0.2, maxSpeed: 0.3, swimFrequency: 2.2, bodyWaves: 0.75, finFlexStrength: 0.085, pectoralStrength: 0.085 };
const DRIFTING = { habit: 'drift', schools: [] } as const;

export const SPECIES: Readonly<Record<SpeciesId, SpeciesParams>> = {
  angelfish: { ...ANGELFISH_BODY, ...DRIFTING, assetNames: ['angelfish', 'angelfish_gold', 'angelfish_platinum', 'angelfish_blue', 'angelfish_koi'], cruiseSpeed: 0.055, heightShares: [0.25, 0.85] },
  discus: { ...ANGELFISH_BODY, ...DRIFTING, assetNames: ['discus'], swimFrequency: 1.8, cruiseSpeed: 0.04, heightShares: [0.15, 0.7] },
  dwarfGourami: { ...DRIFTING, assetNames: ['dwarf_gourami'], bodyLength: 0.12, maxSpeed: 0.26, swimFrequency: 3, bodyWaves: 0.75, finFlexStrength: 0.07, pectoralStrength: 0.1, cruiseSpeed: 0.05, heightShares: [0.35, 0.92] },
  cardinalTetra: { assetNames: ['cardinal_tetra', 'cardinal_tetra_2', 'cardinal_tetra_3'], bodyLength: 0.085, maxSpeed: 0.42, swimFrequency: 7, bodyWaves: 1, finFlexStrength: 0.05, pectoralStrength: 0.1, habit: 'school', cruiseSpeed: 0.085, heightShares: [0.12, 0.9], schools: [0, 0, 1] },
  tigerBarb: { assetNames: ['tiger_barb'], bodyLength: 0.09, maxSpeed: 0.46, swimFrequency: 7, bodyWaves: 0.9, finFlexStrength: 0.05, pectoralStrength: 0.1, habit: 'school', cruiseSpeed: 0.12, heightShares: [0.1, 0.65], schools: [2] },
  platy: { assetNames: ['platy'], bodyLength: 0.085, maxSpeed: 0.34, swimFrequency: 5.5, bodyWaves: 0.9, finFlexStrength: 0.06, pectoralStrength: 0.11, habit: 'school', cruiseSpeed: 0.06, heightShares: [0.3, 0.92], schools: [3] },
  corydoras: { assetNames: ['corydoras'], bodyLength: 0.075, maxSpeed: 0.3, swimFrequency: 5, bodyWaves: 0.85, finFlexStrength: 0.05, pectoralStrength: 0.12, habit: 'root', cruiseSpeed: 0.025, heightShares: [0, 0], schools: [] },
  otocinclus: { assetNames: ['otocinclus'], bodyLength: 0.055, maxSpeed: 0.25, swimFrequency: 7, bodyWaves: 1, finFlexStrength: 0.05, pectoralStrength: 0.1, habit: 'graze', cruiseSpeed: 0.09, heightShares: [0, 0], schools: [] },
};

/** How many of each fish live in the tank. */
export const POPULATION: Readonly<Record<SpeciesId, number>> = { angelfish: 5, discus: 1, dwarfGourami: 6, cardinalTetra: 72, tigerBarb: 16, platy: 14, corydoras: 12, otocinclus: 6 };
