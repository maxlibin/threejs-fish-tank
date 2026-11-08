import { groundHeightAt, type Collider, type GroundGrid } from '../aquascape/colliders';
import { TANK, type Vec3 } from '../tank/dimensions';
import { add, avoidBounds, avoidSolids, isOpenWater, length, pushOutOfSolids, scale, slideOutOfSolids, sub, swimBounds, unit, type FishMode } from './behaviours';
import { SPECIES, type SpeciesId, type SpeciesParams } from './species';

export type { FishMode } from './behaviours';

export type FishState = {
  readonly species: SpeciesId;
  readonly position: Vec3;
  readonly velocity: Vec3;
  /** Unit vector the nose points along; a hovering fish keeps facing somewhere. */
  readonly heading: Vec3;
  readonly swimPhase: number;
  readonly swimAmplitude: number;
  readonly turnCurvature: number;
  readonly finSpread: number;
  readonly mode: FishMode;
  readonly modeSeconds: number;
  /** Where this fish is currently heading, when it has a destination of its own. */
  readonly goal: Vec3;
  /** Each fish's own swimming rhythm, so that no two move in time. */
  readonly tempo: number;
  /** Which school this fish swims with, or -1 for a fish that does not school. */
  readonly school: number;
  /** The part of the tank this fish keeps to, so that fish spread out rather than crowd together. */
  readonly home: Vec3;
  /** Runs at this fish's own pace, and sets when it beats its tail and when it glides. */
  readonly rhythmClock: number;
  /** Whether this fish settles down when it reaches its goal. */
  readonly restsOnArrival: boolean;
};

export type SimEnvironment = {
  readonly colliders: readonly Collider[];
  readonly ground: GroundGrid;
  /** The solids close enough to matter at a point; far cheaper than checking them all. */
  readonly solidsNear: (position: Vec3) => readonly Collider[];
};

const GRID_CELL_METRES = 0.2;
/** Farther than any fish looks ahead or moves in one step, so nothing nearby is ever missed. */
const GRID_REACH_METRES = 0.2;
const NOTHING_NEAR: readonly Collider[] = [];

const gridKey = (column: number, row: number, layer: number): number => (column + 512) * 1048576 + (row + 512) * 1024 + (layer + 512);

/** Prepares the tank for the simulation, sorting solids into a grid by where they are. */
export const createSimEnvironment = (colliders: readonly Collider[], ground: GroundGrid): SimEnvironment => {
  const cells = new Map<number, Collider[]>();
  for (const collider of colliders) {
    const extent = collider.radius + GRID_REACH_METRES;
    const lowest = collider.center.map((value) => Math.floor((value - extent) / GRID_CELL_METRES));
    const highest = collider.center.map((value) => Math.floor((value + extent) / GRID_CELL_METRES));
    for (let column = lowest[0] ?? 0; column <= (highest[0] ?? 0); column += 1) {
      for (let row = lowest[1] ?? 0; row <= (highest[1] ?? 0); row += 1) {
        for (let layer = lowest[2] ?? 0; layer <= (highest[2] ?? 0); layer += 1) {
          const key = gridKey(column, row, layer);
          const cell = cells.get(key);
          if (cell === undefined) cells.set(key, [collider]);
          else cell.push(collider);
        }
      }
    }
  }
  return {
    colliders,
    ground,
    solidsNear: ([x, y, z]: Vec3): readonly Collider[] =>
      cells.get(gridKey(Math.floor(x / GRID_CELL_METRES), Math.floor(y / GRID_CELL_METRES), Math.floor(z / GRID_CELL_METRES))) ?? NOTHING_NEAR,
  };
};

/** Where one school is heading, for how much longer, and whether it has settled down to rest. */
export type SchoolPlan = { readonly goal: Vec3; readonly seconds: number; readonly home: Vec3; readonly resting: boolean };

export type SimState = {
  readonly fish: readonly FishState[];
  readonly rngState: number;
  readonly schools: readonly SchoolPlan[];
  readonly nextStartleSeconds: number;
};

const MAX_FRAME_SECONDS = 0.25;
const MAX_STEP_SECONDS = 1 / 60;
const TWO_PI = Math.PI * 2;
const INNER_X = TANK.width / 2 - TANK.glassThickness;
const INNER_Z = TANK.frontPaneZ - TANK.glassThickness;

const CLEARANCE_SHARE = 0.32;
const SCHOOL_NEIGHBOUR_RANGE = 0.26;
const SCHOOL_SPACING = 0.1;
const MAX_PITCH_RADIANS = 0.45;
/** Below this sideways length a direction is unreliable, so a fish keeps facing the way it was. */
const MIN_ACROSS = 0.01;
/** Which species makes up each school, read from the species table. */
const SCHOOL_SPECIES: ReadonlyMap<number, SpeciesId> = new Map(
  (Object.entries(SPECIES) as [SpeciesId, SpeciesParams][]).flatMap(([species, params]) => params.schools.map((school): [number, SpeciesId] => [school, species])),
);
const SCHOOL_IDS: readonly number[] = [...SCHOOL_SPECIES.keys()].sort((a, b) => a - b);
/** Blocked by wood or rock, a mid-water fish rises over it rather than nosing against it. */
const RISE_OVER_SOLIDS = 0.6;
const SCATTER_SECONDS = 2.2;
const STARTLE_MIN_SECONDS = 45;
const STARTLE_MAX_SECONDS = 130;
/** Burst and glide: a few quick tail beats, then coasting. */
const RHYTHM_RADIANS_PER_SECOND = 2.1;
const GLIDE_SPEED_SHARE = 0.4;
const BURST_SPEED_SHARE = 1.5;
const REST_SPEED_SHARE = 0.08;
const REST_CHANCE = 0.35;
const NEW_HOME_CHANCE = 0.15;
const GOAL_REACHED_METRES = 0.05;

type Random = { next(): number; state(): number };

/** A small seeded generator. Its state lives in SimState, so runs repeat exactly. */
const createRandom = (seed: number): Random => {
  let value = seed >>> 0;
  return {
    next: (): number => {
      value = (value + 0x6d2b79f5) >>> 0;
      let t = value;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    state: (): number => value,
  };
};

const between = (random: Random, low: number, high: number): number => low + (high - low) * random.next();

/** Fish roam almost the whole tank, stopping short of the end glass. */
const ROAM_HALF_WIDTH = 1.3;
/** One trip stays near home, so that it runs across the tank about as much as along it. */
const TRIP_HALF_WIDTH = 0.4;
const FAR_TRIP_CHANCE = 0.12;
/** How often a destination is deliberately behind wood or rock, as seen from the room. */
const BEHIND_SHARE = 0.45;
const BEHIND_GAP_METRES = 0.03;
const NEAR_HOME_METRES = 0.7;
const REST_MAX_HEIGHT_SHARE = 0.6;
const REST_GAP_METRES = 0.04;
const GOAL_ATTEMPTS = 40;

const clampToRoam = (x: number): number => Math.max(-ROAM_HALF_WIDTH, Math.min(ROAM_HALF_WIDTH, x));

const isSwimmable = (point: Vec3, environment: SimEnvironment, clearance: number): boolean =>
  Math.abs(point[0]) <= ROAM_HALF_WIDTH && Math.abs(point[2]) <= INNER_Z - 0.04 && point[1] < TANK.waterSurfaceY - 0.05 && isOpenWater(point, environment.colliders, clearance);

/** The next place to swim to: the far side of the tank from here, near home, and often behind something. */
const swimGoal = (random: Random, environment: SimEnvironment, species: SpeciesId, home: Vec3, fromZ: number): Vec3 => {
  const clearance = SPECIES[species].bodyLength * 0.7;
  const [lowShare, highShare] = SPECIES[species].heightShares;
  const farTrip = random.next() < FAR_TRIP_CHANCE;
  const acrossTank = (): Vec3 => {
    const x = farTrip ? between(random, -ROAM_HALF_WIDTH, ROAM_HALF_WIDTH) : clampToRoam(home[0] + between(random, -TRIP_HALF_WIDTH, TRIP_HALF_WIDTH));
    const z = fromZ > 0 ? between(random, -INNER_Z + 0.06, -0.04) : between(random, 0.04, INNER_Z - 0.06);
    const ground = groundHeightAt(x, z, environment.ground);
    return [x, ground + 0.03 + (TANK.waterSurfaceY - 0.03 - ground - 0.03) * between(random, lowShare, highShare), z];
  };
  const behindSolid = (): Vec3 | null => {
    const solid = environment.colliders[Math.floor(random.next() * environment.colliders.length)];
    if (solid === undefined || Math.abs(solid.center[0] - home[0]) > NEAR_HOME_METRES) return null;
    return [solid.center[0], solid.center[1], solid.center[2] - solid.radius - clearance - BEHIND_GAP_METRES];
  };
  const wantsCover = random.next() < BEHIND_SHARE;
  const attempt = (remaining: number): Vec3 => {
    const candidate = wantsCover ? behindSolid() : acrossTank();
    if (candidate !== null && isSwimmable(candidate, environment, clearance)) return candidate;
    return remaining === 0 ? acrossTank() : attempt(remaining - 1);
  };
  return attempt(GOAL_ATTEMPTS);
};

/** A sheltered spot to settle in: low, near home, and tucked against wood or rock. */
const restingSpot = (random: Random, environment: SimEnvironment, species: SpeciesId, home: Vec3): Vec3 => {
  const clearance = SPECIES[species].bodyLength * 0.7;
  const highest = TANK.standTopY + TANK.height * REST_MAX_HEIGHT_SHARE;
  const attempt = (remaining: number): Vec3 => {
    const solid = environment.colliders[Math.floor(random.next() * environment.colliders.length)];
    const angle = between(random, 0, TWO_PI);
    const gap = solid === undefined ? 0 : solid.radius + clearance + REST_GAP_METRES;
    const candidate: Vec3 = solid === undefined ? home : [solid.center[0] + Math.cos(angle) * gap, solid.center[1], solid.center[2] + Math.sin(angle) * gap];
    if (solid !== undefined && Math.abs(solid.center[0] - home[0]) <= NEAR_HOME_METRES && candidate[1] < highest && isSwimmable(candidate, environment, clearance)) return candidate;
    if (remaining > 0) return attempt(remaining - 1);
    const z = between(random, -INNER_Z + 0.06, INNER_Z - 0.06);
    return [home[0], groundHeightAt(home[0], z, environment.ground) + clearance + REST_GAP_METRES, z];
  };
  return attempt(GOAL_ATTEMPTS);
};

/** Homes spread evenly along the tank, in an order that does not line up with anything else. */
const homeAlongTank = (slot: number, random: Random): Vec3 => [clampToRoam((((slot * 0.618 + 0.1) % 1) * 2 - 1) * ROAM_HALF_WIDTH), 0, between(random, -INNER_Z + 0.08, INNER_Z - 0.08)];

const speciesOfSchool = (school: number): SpeciesId => {
  const species = SCHOOL_SPECIES.get(school);
  if (species === undefined) throw new Error(`No species swims in school ${school}. Check the schools in src/fish/species.ts.`);
  return species;
};

const clampToBounds = (position: Vec3, species: SpeciesId, ground: GroundGrid): Vec3 => {
  const { min, max } = swimBounds(species, position[0], position[2], ground);
  return [Math.min(max[0], Math.max(min[0], position[0])), Math.min(max[1], Math.max(min[1], position[1])), Math.min(max[2], Math.max(min[2], position[2]))];
};

/** Keeps a fish in the water and out of solids, whatever steering asked for. */
const settle = (position: Vec3, species: SpeciesId, environment: SimEnvironment): Vec3 => {
  const clearance = SPECIES[species].bodyLength * CLEARANCE_SHARE;
  const inside = clampToBounds(position, species, environment.ground);
  const near = environment.solidsNear(inside);
  const pushed = clampToBounds(pushOutOfSolids(inside, near, clearance), species, environment.ground);
  return clampToBounds(slideOutOfSolids(pushed, near, clearance), species, environment.ground);
};

const glassGoal = (random: Random, environment: SimEnvironment): Vec3 => {
  const pane = random.next();
  const x = between(random, -INNER_X + 0.08, INNER_X - 0.08);
  const ground = groundHeightAt(x, 0, environment.ground);
  const y = between(random, ground + 0.06, TANK.waterSurfaceY - 0.08);
  return pane < 0.7 ? [x, y, INNER_Z - 0.013] : [x, y, -INNER_Z + 0.013];
};

const rootingGoal = (random: Random, environment: SimEnvironment): Vec3 => {
  const x = between(random, -INNER_X + 0.08, INNER_X - 0.08);
  const z = between(random, -0.02, INNER_Z - 0.03);
  return [x, groundHeightAt(x, z, environment.ground) + 0.015, z];
};

const createFish = (species: SpeciesId, index: number, random: Random, environment: SimEnvironment, schools: readonly SchoolPlan[]): FishState => {
  const params = SPECIES[species];
  const school = params.schools[index % Math.max(params.schools.length, 1)] ?? -1;
  const startMode: FishMode = params.habit === 'school' ? 'cruise' : params.habit === 'drift' ? 'hover' : params.habit === 'root' ? 'root' : 'graze';
  const schoolPlan = schools[school];
  const home = schoolPlan === undefined ? homeAlongTank(index, random) : schoolPlan.home;
  const goal = params.habit === 'root' ? rootingGoal(random, environment) : params.habit === 'graze' ? glassGoal(random, environment) : swimGoal(random, environment, species, home, home[2]);
  const near: Vec3 = schoolPlan === undefined ? goal : add(schoolPlan.goal, [between(random, -0.09, 0.09), between(random, -0.05, 0.05), between(random, -0.05, 0.05)]);
  const heading = unit([random.next() < 0.5 ? -1 : 1, between(random, -0.05, 0.05), between(random, -0.5, 0.5)]);
  return {
    species,
    position: settle(near, species, environment),
    velocity: [0, 0, 0],
    heading,
    swimPhase: random.next() * TWO_PI,
    swimAmplitude: 0.1,
    turnCurvature: 0,
    finSpread: 1,
    mode: startMode,
    modeSeconds: between(random, 3, 18),
    goal,
    tempo: between(random, 0.82, 1.18),
    school,
    home,
    rhythmClock: between(random, 0, TWO_PI),
    restsOnArrival: false,
  };
};

/** Creates every fish in open water, from a seed, so a run repeats exactly. */
export const createInitialState = (seed: number, population: Readonly<Record<SpeciesId, number>>, environment: SimEnvironment): SimState => {
  const random = createRandom(seed);
  const schools = SCHOOL_IDS.map((school): SchoolPlan => {
    const home = homeAlongTank(school, random);
    return { goal: swimGoal(random, environment, speciesOfSchool(school), home, home[2]), seconds: between(random, 8, 20), home, resting: false };
  });
  const species = Object.entries(population).flatMap(([name, count]) => Array.from({ length: count }, () => name as SpeciesId));
  const fish = species.map((name, index) => createFish(name, index, random, environment, schools));
  return { fish, rngState: random.state(), schools, nextStartleSeconds: between(random, STARTLE_MIN_SECONDS, STARTLE_MAX_SECONDS) };
};

type SchoolForces = { readonly separation: Vec3; readonly alignment: Vec3; readonly cohesion: Vec3 };
const NO_SCHOOL_FORCES: SchoolForces = { separation: [0, 0, 0], alignment: [0, 0, 0], cohesion: [0, 0, 0] };

/** Runs for every pair of nearby schoolmates at every step, so it adds up numbers rather than allocating vectors. */
const schoolForces = (fish: FishState, schoolmates: readonly FishState[]): SchoolForces => {
  const [x, y, z] = fish.position;
  let count = 0;
  let separationX = 0;
  let separationY = 0;
  let separationZ = 0;
  let headingX = 0;
  let headingY = 0;
  let headingZ = 0;
  let centreX = 0;
  let centreY = 0;
  let centreZ = 0;
  for (const other of schoolmates) {
    if (other === fish) continue;
    const awayX = x - other.position[0];
    const awayY = y - other.position[1];
    const awayZ = z - other.position[2];
    const gapSquared = awayX * awayX + awayY * awayY + awayZ * awayZ;
    if (gapSquared > SCHOOL_NEIGHBOUR_RANGE * SCHOOL_NEIGHBOUR_RANGE) continue;
    count += 1;
    if (gapSquared < SCHOOL_SPACING * SCHOOL_SPACING && gapSquared > 1e-12) {
      const gap = Math.sqrt(gapSquared);
      const push = (1 - gap / SCHOOL_SPACING) / gap;
      separationX += awayX * push;
      separationY += awayY * push;
      separationZ += awayZ * push;
    }
    headingX += other.velocity[0];
    headingY += other.velocity[1];
    headingZ += other.velocity[2];
    centreX += other.position[0];
    centreY += other.position[1];
    centreZ += other.position[2];
  }
  if (count === 0) return NO_SCHOOL_FORCES;
  return {
    separation: [separationX, separationY, separationZ],
    alignment: [headingX / count - fish.velocity[0], headingY / count - fish.velocity[1], headingZ / count - fish.velocity[2]],
    cohesion: [centreX / count - x, centreY / count - y, centreZ / count - z],
  };
};

type Plan = { readonly acceleration: Vec3; readonly cruiseSpeed: number; readonly mode: FishMode; readonly modeSeconds: number; readonly goal: Vec3; readonly restsOnArrival?: boolean };

const towards = (from: Vec3, to: Vec3, strength: number): Vec3 => scale(unit(sub(to, from)), strength);

/** How fast this fish wants to swim right now: a few quick tail beats, then a glide. */
const burstAndGlide = (fish: FishState): number => {
  const beat = Math.max(0, Math.sin(fish.rhythmClock));
  return GLIDE_SPEED_SHARE + (BURST_SPEED_SHARE - GLIDE_SPEED_SHARE) * beat * beat * beat;
};

const planSchooler = (fish: FishState, schoolmates: readonly FishState[], plan: SchoolPlan, startled: boolean, dt: number, random: Random): Plan => {
  const forces = schoolForces(fish, schoolmates);
  const scattering = startled || (fish.mode === 'scatter' && fish.modeSeconds > 0);
  if (scattering) {
    const away = startled ? unit([between(random, -1, 1), between(random, -0.5, 0.5), between(random, -0.9, 0.9)]) : unit(fish.velocity);
    return { acceleration: add(scale(away, 2.4), scale(forces.separation, 0.6)), cruiseSpeed: SPECIES[fish.species].maxSpeed, mode: 'scatter', modeSeconds: startled ? between(random, SCATTER_SECONDS * 0.6, SCATTER_SECONDS) : fish.modeSeconds - dt, goal: fish.goal, restsOnArrival: false };
  }
  const cruise = SPECIES[fish.species].cruiseSpeed * fish.tempo;
  if (plan.resting) {
    const acceleration = add(add(scale(forces.separation, 2.6), scale(forces.alignment, 0.5)), add(scale(forces.cohesion, 1.2), towards(fish.position, plan.goal, 0.14)));
    return { acceleration, cruiseSpeed: cruise * REST_SPEED_SHARE, mode: 'rest', modeSeconds: 0, goal: fish.goal, restsOnArrival: false };
  }
  const acceleration = add(
    add(scale(forces.separation, 2.6), scale(forces.alignment, 1.4)),
    add(scale(forces.cohesion, 2.2), towards(fish.position, plan.goal, 0.32)),
  );
  return { acceleration, cruiseSpeed: cruise * burstAndGlide(fish), mode: 'cruise', modeSeconds: 0, goal: fish.goal, restsOnArrival: false };
};

const planDrifter = (fish: FishState, dt: number, environment: SimEnvironment, random: Random): Plan => {
  const remaining = fish.modeSeconds - dt;
  const cruise = SPECIES[fish.species].cruiseSpeed;
  const still = (mode: FishMode, seconds: number): Plan => ({ acceleration: scale(fish.velocity, -1.4), cruiseSpeed: cruise * REST_SPEED_SHARE, mode, modeSeconds: seconds, goal: fish.goal, restsOnArrival: false });
  if (fish.mode === 'hover' || fish.mode === 'rest') {
    if (remaining > 0) return still(fish.mode, remaining);
    const restsOnArrival = fish.mode === 'hover' && random.next() < REST_CHANCE;
    const goal = restsOnArrival ? restingSpot(random, environment, fish.species, fish.home) : swimGoal(random, environment, fish.species, fish.home, fish.position[2]);
    return { acceleration: [0, 0, 0], cruiseSpeed: cruise, mode: 'cruise', modeSeconds: between(random, 12, 30), goal, restsOnArrival };
  }
  const arrived = length(sub(fish.goal, fish.position)) < GOAL_REACHED_METRES;
  if (remaining <= 0 || arrived) return fish.restsOnArrival ? still('rest', between(random, 30, 90)) : still('hover', between(random, 6, 18));
  return { acceleration: towards(fish.position, fish.goal, 0.12), cruiseSpeed: cruise * fish.tempo * burstAndGlide(fish), mode: 'cruise', modeSeconds: remaining, goal: fish.goal, restsOnArrival: fish.restsOnArrival };
};

const planCorydoras = (fish: FishState, dt: number, environment: SimEnvironment, random: Random): Plan => {
  const remaining = fish.modeSeconds - dt;
  if (fish.mode === 'surface') {
    if (fish.position[1] > TANK.waterSurfaceY - 0.04 || remaining <= 0) {
      return { acceleration: [0, -0.3, 0], cruiseSpeed: 0.1, mode: 'root', modeSeconds: between(random, 40, 200), goal: rootingGoal(random, environment) };
    }
    return { acceleration: towards(fish.position, [fish.position[0], TANK.waterSurfaceY, fish.position[2]], 1.2), cruiseSpeed: SPECIES.corydoras.maxSpeed, mode: 'surface', modeSeconds: remaining, goal: fish.goal };
  }
  if (remaining <= 0) return { acceleration: [0, 0.6, 0], cruiseSpeed: SPECIES.corydoras.maxSpeed, mode: 'surface', modeSeconds: 6, goal: fish.goal };
  const reached = length(sub(fish.goal, fish.position)) < 0.03;
  const goal = reached ? rootingGoal(random, environment) : fish.goal;
  return { acceleration: towards(fish.position, goal, 0.09), cruiseSpeed: 0.025 * fish.tempo, mode: 'root', modeSeconds: remaining, goal };
};

const planOtocinclus = (fish: FishState, dt: number, environment: SimEnvironment, random: Random): Plan => {
  const remaining = fish.modeSeconds - dt;
  if (fish.mode === 'cruise') {
    const arrived = length(sub(fish.goal, fish.position)) < 0.02;
    if (arrived) return { acceleration: scale(fish.velocity, -6), cruiseSpeed: 0, mode: 'graze', modeSeconds: between(random, 18, 80), goal: fish.goal };
    return { acceleration: towards(fish.position, fish.goal, 0.5), cruiseSpeed: 0.09, mode: 'cruise', modeSeconds: remaining, goal: fish.goal };
  }
  if (remaining <= 0) return { acceleration: [0, 0, 0], cruiseSpeed: 0.09, mode: 'cruise', modeSeconds: 30, goal: glassGoal(random, environment) };
  // A slow creep over the glass, with stillness in between.
  const creep = Math.sin(remaining * 0.7) > 0.45 ? 0.006 : 0;
  return { acceleration: add(towards(fish.position, fish.goal, 0.25), scale(fish.velocity, -4)), cruiseSpeed: creep, mode: 'graze', modeSeconds: remaining, goal: fish.goal };
};

/** A unit heading within the pitch fish really swim at: they stay nearly level and drift up or down. */
const limitPitch = (direction: Vec3, fallback: Vec3): Vec3 => {
  const across = Math.hypot(direction[0], direction[2]);
  const facing = across > MIN_ACROSS ? unit([direction[0], 0, direction[2]]) : unit([fallback[0], 0, fallback[2]]);
  const pitch = Math.max(-MAX_PITCH_RADIANS, Math.min(MAX_PITCH_RADIANS, Math.atan2(direction[1], Math.max(across, MIN_ACROSS))));
  return add(scale(facing, Math.cos(pitch)), [0, Math.sin(pitch), 0]);
};

const stepFish = (fish: FishState, plan: Plan, dt: number, environment: SimEnvironment): FishState => {
  const params = SPECIES[fish.species];
  const steerStrength = plan.mode === 'scatter' ? 2 : 0.9;
  const midWater = params.habit === 'school' || params.habit === 'drift';
  // Otocinclus live on the glass, so it does not repel them.
  const glassPush = params.habit === 'graze' ? 0 : 1.8;
  const fromSolids = scale(avoidSolids(fish.position, environment.solidsNear(fish.position), Math.min(0.05 + params.bodyLength * 0.5, GRID_REACH_METRES)), 1.4);
  const rise: Vec3 = midWater ? [0, length(fromSolids) * RISE_OVER_SOLIDS, 0] : [0, 0, 0];
  const avoidance = add(add(scale(avoidBounds(fish.position, fish.species, environment.ground), glassPush), fromSolids), rise);
  const acceleration = add(scale(plan.acceleration, steerStrength), avoidance);
  const velocity = add(fish.velocity, scale(acceleration, dt));
  const speed = length(velocity);
  // Fish ease toward a comfortable speed, and never exceed their top speed.
  const eased = speed + (plan.cruiseSpeed - speed) * Math.min(1, dt * (plan.mode === 'scatter' ? 5 : 3));
  const limited = scale(unit(velocity), Math.min(params.maxSpeed, Math.max(eased, 0)));
  const position = settle(add(fish.position, scale(limited, dt)), fish.species, environment);
  const actual = scale(sub(position, fish.position), 1 / dt);

  const actualSpeed = length(actual);
  const wanted = actualSpeed > 0.012 ? limitPitch(actual, fish.heading) : fish.heading;
  const turnRate = params.habit === 'drift' ? 1.1 : params.habit === 'graze' ? 2 : 4.5;
  // Limited again after blending, because old and new headings nearly cancel out during a U-turn.
  const heading = limitPitch(add(fish.heading, scale(sub(wanted, fish.heading), Math.min(1, dt * turnRate))), fish.heading);
  const turning = (heading[0] * fish.heading[2] - heading[2] * fish.heading[0]) / dt;

  const effort = Math.min(1, actualSpeed / params.maxSpeed);
  const beat = params.swimFrequency * fish.tempo * (0.22 + effort * 1.1);
  const amplitude = (plan.mode === 'graze' || plan.mode === 'rest' ? 0.02 : 0.07) + effort * 0.5;
  return {
    ...fish,
    position,
    velocity: actual,
    heading,
    swimPhase: (fish.swimPhase + beat * TWO_PI * dt) % TWO_PI,
    swimAmplitude: fish.swimAmplitude + (amplitude - fish.swimAmplitude) * Math.min(1, dt * 3),
    turnCurvature: fish.turnCurvature + (Math.max(-0.5, Math.min(0.5, turning * 0.32)) - fish.turnCurvature) * Math.min(1, dt * 4),
    finSpread: fish.finSpread + ((plan.mode === 'scatter' ? 0.55 : 1 - effort * 0.45) - fish.finSpread) * Math.min(1, dt * 3),
    mode: plan.mode,
    modeSeconds: plan.modeSeconds,
    goal: plan.goal,
    rhythmClock: (fish.rhythmClock + RHYTHM_RADIANS_PER_SECOND * fish.tempo * dt) % TWO_PI,
    restsOnArrival: plan.restsOnArrival ?? fish.restsOnArrival,
  };
};

/** What a school does next: rest for a while, wake up, or set off across the tank, sometimes to a new home. */
const nextSchoolPlan = (plan: SchoolPlan, school: number, centre: Vec3, random: Random, environment: SimEnvironment): SchoolPlan => {
  const species = speciesOfSchool(school);
  const home: Vec3 = random.next() < NEW_HOME_CHANCE ? homeAlongTank(Math.floor(random.next() * 100), random) : plan.home;
  if (!plan.resting && random.next() < REST_CHANCE) return { goal: restingSpot(random, environment, species, home), seconds: between(random, 30, 80), home, resting: true };
  return { goal: swimGoal(random, environment, species, home, centre[2]), seconds: between(random, 8, 20), home, resting: false };
};

const substep = (state: SimState, dt: number, environment: SimEnvironment): SimState => {
  const random = createRandom(state.rngState);
  const startled = state.nextStartleSeconds - dt <= 0;
  const schoolers = state.fish.filter((fish) => fish.school >= 0);
  const schoolmates = SCHOOL_IDS.map((school) => schoolers.filter((fish) => fish.school === school));
  const schools = state.schools.map((plan, index): SchoolPlan => {
    if (plan.seconds - dt > 0) return { ...plan, seconds: plan.seconds - dt };
    const members = schoolmates[index] ?? [];
    const centre = members[0]?.position ?? plan.home;
    return nextSchoolPlan(plan, SCHOOL_IDS[index] ?? 0, centre, random, environment);
  });
  const fish = state.fish.map((current) => {
    const habit = SPECIES[current.species].habit;
    const plan =
      habit === 'school'
        ? planSchooler(current, schoolmates[current.school] ?? [], schools[current.school] ?? { goal: current.goal, seconds: 0, home: current.home, resting: false }, startled, dt, random)
        : habit === 'drift'
          ? planDrifter(current, dt, environment, random)
          : habit === 'root'
            ? planCorydoras(current, dt, environment, random)
            : planOtocinclus(current, dt, environment, random);
    return stepFish(current, plan, dt, environment);
  });
  return {
    fish,
    rngState: random.state(),
    schools,
    nextStartleSeconds: startled ? between(random, STARTLE_MIN_SECONDS, STARTLE_MAX_SECONDS) : state.nextStartleSeconds - dt,
  };
};

/**
 * Advances the simulation. A long gap, such as a hidden tab, simulates at most a quarter of a second,
 * so fish carry on from where they were rather than jumping.
 */
export const stepSimulation = (state: SimState, frameSeconds: number, environment: SimEnvironment): SimState => {
  const seconds = Math.min(frameSeconds, MAX_FRAME_SECONDS);
  if (seconds <= 0) return state;
  const steps = Math.ceil(seconds / MAX_STEP_SECONDS);
  const dt = seconds / steps;
  return Array.from({ length: steps }).reduce<SimState>((current) => substep(current, dt, environment), state);
};
