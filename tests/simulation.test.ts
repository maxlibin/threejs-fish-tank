import { describe, expect, test } from 'vitest';
import type { ColliderFile } from '../src/aquascape/colliders';
import { distanceToNearestSolid } from '../src/aquascape/colliders';
import { createInitialState, createSimEnvironment, stepSimulation, type FishMode, type FishState, type SimEnvironment, type SimState } from '../src/fish/simulation';
import { POPULATION, SPECIES, type SpeciesId } from '../src/fish/species';
import { TANK, type Vec3 } from '../src/tank/dimensions';

const colliderFile: ColliderFile = {
  colliders: [
    { center: [-0.5, 0.8, 0], radius: 0.18 },
    { center: [0.7, 0.78, -0.05], radius: 0.2 },
    { center: [0.1, 0.72, 0.05], radius: 0.12 },
  ],
  hardscapeSamples: [],
  ground: { minX: -1.5, minZ: -0.35, stepX: 3, stepZ: 0.7, columns: 2, rows: 2, heights: [0.66, 0.66, 0.66, 0.66] },
};
const environment: SimEnvironment = createSimEnvironment(colliderFile.colliders, colliderFile.ground);
const FRAME_SECONDS = 1 / 60;
const TEN_MINUTES_OF_FRAMES = 36_000;

const glassClearance = ([x, y, z]: Vec3): number => {
  const inner = TANK.glassThickness;
  return Math.min(TANK.width / 2 - inner - Math.abs(x), TANK.frontPaneZ - inner - Math.abs(z), TANK.waterSurfaceY - y, y - (TANK.standTopY + inner));
};

const ofSpecies = (state: SimState, species: SpeciesId): readonly FishState[] => state.fish.filter((fish) => fish.species === species);
const distance = (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const speed = (fish: FishState): number => Math.hypot(...fish.velocity);

type Recording = {
  readonly medianNeighbour: readonly number[];
  readonly swimPhases: readonly (readonly number[])[];
  readonly shareInMode: (species: SpeciesId, mode: FishMode) => number;
  readonly meanSpeed: (species: SpeciesId) => number;
  readonly scatterEvents: number;
  readonly longestScatteredSeconds: number;
  readonly surfaceVisits: number;
  readonly smallestClearance: number;
  readonly smallestSolidClearance: number;
  readonly shareSideOn: number;
  readonly steepestMidWaterHeading: number;
};

const median = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;

const recordRun = (): Recording => {
  const modes = new Map<string, number>();
  const counts = new Map<SpeciesId, number>();
  const speeds = new Map<SpeciesId, number>();
  const medianNeighbour: number[] = [];
  const swimPhases: (readonly number[])[] = [];
  let state = createInitialState(1, POPULATION, environment);
  let smallestClearance = Number.POSITIVE_INFINITY;
  let smallestSolidClearance = Number.POSITIVE_INFINITY;
  let scatterEvents = 0;
  let longestScatteredSeconds = 0;
  let scatteredFor = 0;
  let wasScattering = false;
  let surfaceVisits = 0;
  const wasSurfacing = new Map<number, boolean>();
  let sideOn = 0;
  let schoolSamples = 0;
  let steepestMidWaterHeading = 0;

  for (let frame = 0; frame < TEN_MINUTES_OF_FRAMES; frame += 1) {
    state = stepSimulation(state, FRAME_SECONDS, environment);
    state.fish.forEach((fish, index) => {
      const key = `${fish.species}:${fish.mode}`;
      modes.set(key, (modes.get(key) ?? 0) + 1);
      counts.set(fish.species, (counts.get(fish.species) ?? 0) + 1);
      speeds.set(fish.species, (speeds.get(fish.species) ?? 0) + speed(fish));
      const clearance = SPECIES[fish.species].bodyLength * 0.25;
      smallestClearance = Math.min(smallestClearance, glassClearance(fish.position) - clearance);
      smallestSolidClearance = Math.min(smallestSolidClearance, distanceToNearestSolid(fish.position, environment.colliders) - clearance);
      if (fish.species === 'cardinalTetra' || fish.species === 'angelfish') {
        schoolSamples += 1;
        steepestMidWaterHeading = Math.max(steepestMidWaterHeading, Math.abs(fish.heading[1]));
        // Facing along the tank rather than at the viewer: within about 50 degrees of side-on.
        if (Math.abs(fish.heading[2]) < 0.76) sideOn += 1;
      }
      const surfacing = fish.mode === 'surface';
      if (surfacing && wasSurfacing.get(index) !== true) surfaceVisits += 1;
      wasSurfacing.set(index, surfacing);
    });
    const tetras = ofSpecies(state, 'cardinalTetra');
    const scattering = tetras.some((fish) => fish.mode === 'scatter');
    if (scattering && !wasScattering) scatterEvents += 1;
    scatteredFor = scattering ? scatteredFor + FRAME_SECONDS : 0;
    longestScatteredSeconds = Math.max(longestScatteredSeconds, scatteredFor);
    wasScattering = scattering;
    if (frame % 60 === 0) {
      swimPhases.push(tetras.map((fish) => fish.swimPhase));
      medianNeighbour.push(median(tetras.map((fish) => Math.min(...tetras.filter((other) => other !== fish).map((other) => distance(fish.position, other.position))))));
    }
  }
  return {
    medianNeighbour,
    swimPhases,
    shareInMode: (species, mode) => (modes.get(`${species}:${mode}`) ?? 0) / (counts.get(species) ?? 1),
    meanSpeed: (species) => (speeds.get(species) ?? 0) / (counts.get(species) ?? 1),
    scatterEvents,
    longestScatteredSeconds,
    surfaceVisits,
    smallestClearance,
    smallestSolidClearance,
    shareSideOn: sideOn / schoolSamples,
    steepestMidWaterHeading,
  };
};

const circularVariance = (phases: readonly number[]): number => {
  const c = phases.reduce((sum, phase) => sum + Math.cos(phase), 0) / phases.length;
  const s = phases.reduce((sum, phase) => sum + Math.sin(phase), 0) / phases.length;
  return 1 - Math.hypot(c, s);
};

describe('fish behaviour over ten simulated minutes', () => {
  const run = recordRun();

  test('no fish reaches glass or solids', () => {
    expect(run.smallestClearance).toBeGreaterThan(0);
    expect(run.smallestSolidClearance).toBeGreaterThan(0);
  });

  test('tetras school, scatter, and regroup', () => {
    const inSchool = run.medianNeighbour.filter((value) => value > 0.02 && value < 0.16).length / run.medianNeighbour.length;
    expect(inSchool).toBeGreaterThan(0.85);
    expect(run.scatterEvents).toBeGreaterThan(0);
    expect(run.longestScatteredSeconds).toBeLessThan(30);
  });

  test('fish do not swim in sync', () => {
    const variances = run.swimPhases.map(circularVariance);
    expect(variances.reduce((sum, value) => sum + value, 0) / variances.length).toBeGreaterThan(0.5);
  });

  test('angelfish drift and hover', () => {
    for (const species of ['angelfish'] as const) {
      expect(run.meanSpeed(species)).toBeLessThan(0.08);
      expect(run.shareInMode(species, 'hover') + run.shareInMode(species, 'rest')).toBeGreaterThan(0.25);
    }
  });

  test('fish often show their sides, while also turning into the tank', () => {
    expect(run.shareSideOn).toBeGreaterThan(0.55);
    expect(run.shareSideOn).toBeLessThan(0.98);
  });

  test('mid-water fish stay nearly level, even while rising or sinking', () => {
    expect(run.steepestMidWaterHeading).toBeLessThan(0.5);
  });

  test('corydoras root and visit the surface', () => {
    expect(run.shareInMode('corydoras', 'root')).toBeGreaterThan(0.6);
    expect(run.surfaceVisits).toBeGreaterThanOrEqual(POPULATION.corydoras);
  });

  test('otocinclus cling to surfaces', () => {
    expect(run.shareInMode('otocinclus', 'graze')).toBeGreaterThan(0.7);
  });
});

describe('stepSimulation', () => {
  test('a five-minute frame gap moves fish no farther than 0.25 s of swimming', () => {
    const state = createInitialState(2, POPULATION, environment);
    const next = stepSimulation(state, 300, environment);
    next.fish.forEach((fish, index) => {
      const before = state.fish[index];
      if (before === undefined) throw new Error('A fish vanished.');
      expect(fish.position.every(Number.isFinite)).toBe(true);
      expect(distance(before.position, fish.position)).toBeLessThan(SPECIES[fish.species].maxSpeed * 0.3);
      expect(glassClearance(fish.position)).toBeGreaterThan(0);
    });
  });

  test('the input state is not changed', () => {
    const state = createInitialState(3, POPULATION, environment);
    const frozen = JSON.stringify(state);
    stepSimulation(state, FRAME_SECONDS, environment);
    expect(JSON.stringify(state)).toBe(frozen);
  });

  test('swim phase stays in a small range for smooth animation', () => {
    const run = (): SimState => {
      let state = createInitialState(4, POPULATION, environment);
      for (let frame = 0; frame < 6000; frame += 1) state = stepSimulation(state, FRAME_SECONDS, environment);
      return state;
    };
    for (const fish of run().fish) {
      expect(fish.swimPhase).toBeGreaterThanOrEqual(0);
      expect(fish.swimPhase).toBeLessThan(Math.PI * 2);
    }
  });
});
