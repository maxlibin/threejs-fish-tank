import { exp, float, positionWorld, vec3 } from 'three/tsl';
import { DirectionalLight, HemisphereLight, Object3D, PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { createRenderer, deviceLostError, nativeDevice } from './app/bootstrap';
import type { TankDebugApi } from './app/debugApi';
import { showFatalError } from './app/errorOverlay';
import { addFrame, emptyFrameWindow, summarizeFrames, type FrameWindow } from './app/frameStats';
import { parseColliders } from './aquascape/colliders';
import { loadHardscape } from './aquascape/hardscape';
import { createLeafCells, parsePlantPoints, updatePlantBumps, type LeafCells, type PlantBump } from './aquascape/plantBumps';
import { plantPhase, setPlantBumps } from './aquascape/plantNodes';
import { loadPlantScans } from './aquascape/plantScans';
import { loadPlants } from './aquascape/plants';
import { createCameraRig } from './camera/cameraRig';
import { AIR_STONE, TANK, type Vec2, type Vec3 } from './tank/dimensions';
import { FRONT_PLANE, createDepthPunch, renderPortals } from './tank/portals';
import { createImagePipeline } from './render/pipeline';
import { loadRoom } from './room/room';
import { createFishMesh, loadFishAsset } from './fish/fishMesh';
import { createInitialState, createSimEnvironment, stepSimulation, type FishState, type SimEnvironment, type SimState } from './fish/simulation';
import { POPULATION, SPECIES, type SpeciesId } from './fish/species';
import { breathPhase } from './fish/swimNodes';
import { apparentPosition } from './tank/refraction';
import { createTankInterior, createTankShell } from './tank/tankShell';
import { LIGHT_DIRECTION, createCaustics, type Caustics } from './water/caustics';
import { createWaterSurface } from './water/surface';
import { createUnderwaterEnvironment } from './water/environment';
import { WATER_TIME_WRAP_SECONDS, createBubbles, createParticles, waterFrameSeconds, waterTime } from './water/particles';
import { useCaustics } from './water/volume';

const CAMERA_FOV_DEGREES = 46;
const MAX_FRAME_SECONDS = 0.25;

const requireCanvas = (): HTMLCanvasElement => {
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-testid="app-canvas"]');
  if (canvas === null) throw new Error('index.html is missing the app canvas (data-testid="app-canvas").');
  return canvas;
};

const LIGHT_DISTANCE = 1.2;
const LED_INTENSITY = 27;
const LIGHT_FALLOFF_PER_METRE = 0.66;
const SHADOW_MAP_SIZE = 3072;

/** The LED bar over the tank. Its colour node carries the caustics, so every lit material under it gets them. */
const addTankLight = (scene: Scene, caustics: Caustics): DirectionalLight => {
  scene.add(new HemisphereLight(0xd4dccc, 0x7b7460, 0.55));
  const light = new DirectionalLight(0xfff6e8, LED_INTENSITY);
  // Light weakens on its way down through the water, so the top of the tank is far brighter than the bottom.
  const belowSurface = float(TANK.waterSurfaceY).sub(positionWorld.y).max(0);
  Object.assign(light, { colorNode: vec3(1, 0.965, 0.9).mul(LED_INTENSITY).mul(exp(belowSurface.mul(-LIGHT_FALLOFF_PER_METRE))).mul(caustics.brightnessAtNode(positionWorld)) });
  light.position.set(-LIGHT_DIRECTION.x * LIGHT_DISTANCE, TANK.waterSurfaceY - LIGHT_DIRECTION.y * LIGHT_DISTANCE, -LIGHT_DIRECTION.z * LIGHT_DISTANCE);
  light.castShadow = true;
  light.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  Object.assign(light.shadow.camera, { left: -1.65, right: 1.65, top: 0.6, bottom: -0.6, near: 0.2, far: 3.0 });
  light.shadow.camera.updateProjectionMatrix();
  light.shadow.radius = 3;
  light.shadow.bias = -0.0004;
  light.shadow.autoUpdate = false;
  scene.add(light, light.target);
  light.target.position.set(0, TANK.standTopY, 0);
  return light;
};

/** Refracted and mirrored draws land away from where three.js thinks the object is, so it must not cull them. */
const addToContents = (contents: Scene, object: Object3D): void => {
  object.traverse((child) => {
    child.frustumCulled = false;
  });
  contents.add(object);
};

const BREATHS_PER_SECOND = 1.6;
const PLANT_SWAYS_PER_SECOND = 0.2;
const FOCUS_DAMPING_PER_SECOND = 1.1;
const DEFAULT_FOCUS_METRES = 2;
const SIMULATION_SEED = 7;
const SHADOW_UPDATE_EVERY_FRAMES = 3;

const loadLeafCells = async (): Promise<LeafCells> => {
  const url = '/assets/aquascape/plant_points.json';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}. Rebuild it with tools/blender/build_aquascape.py.`);
  return createLeafCells(parsePlantPoints(await response.json()));
};

const loadEnvironment = async (): Promise<SimEnvironment> => {
  const url = '/assets/aquascape/colliders.json';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load ${url}: HTTP ${response.status}. Rebuild it with tools/blender/build_aquascape.py.`);
  const { colliders, ground } = parseColliders((await response.json()) as object);
  return createSimEnvironment(colliders, ground);
};

/** Focus on the fish nearest the view's centre line, at the distance refraction makes it appear. */
const focusDistanceFor = (camera: PerspectiveCamera, fish: readonly FishState[]): number => {
  if (fish.length === 0) return DEFAULT_FOCUS_METRES;
  const eye: Vec3 = [camera.position.x, camera.position.y, camera.position.z];
  const forward = camera.getWorldDirection(new Vector3());
  const distances = fish.map((state) => {
    const apparent = apparentPosition(eye, state.position, FRONT_PLANE, TANK.iorWater);
    const toFish = new Vector3(apparent[0] - eye[0], apparent[1] - eye[1], apparent[2] - eye[2]);
    return { depth: toFish.dot(forward), offAxis: toFish.clone().cross(forward).length() / Math.max(toFish.length(), 1e-3) };
  });
  const nearest = distances.reduce((best, candidate) => (candidate.offAxis < best.offAxis ? candidate : best));
  return nearest.depth;
};

const start = async (): Promise<void> => {
  const canvas = requireCanvas();
  const renderer = await createRenderer(canvas);
  const device = nativeDevice(renderer);

  void device.lost.then((info) => {
    void renderer.setAnimationLoop(null);
    showFatalError(deviceLostError(info.reason, info.message));
  });

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.autoClear = false;
  const camera = new PerspectiveCamera(CAMERA_FOV_DEGREES, 1, 0.02, 30);
  const rig = createCameraRig(camera, canvas);

  const room = await loadRoom(renderer);
  const shellScene = new Scene();
  shellScene.environment = room.environment;
  shellScene.add(new HemisphereLight(0xffffff, 0x302820, 0.35));
  shellScene.add(createTankShell());
  const surface = createWaterSurface(renderer);
  shellScene.add(surface.mesh);
  const caustics = createCaustics(renderer);
  useCaustics(caustics);
  const contents = new Scene();
  const tankLight = addTankLight(contents, caustics);
  contents.environment = await createUnderwaterEnvironment(renderer);
  contents.environmentIntensity = 0.55;
  // Tests with markers in the water can ask for an empty tank, for a clear line of sight.
  const isBareTank = import.meta.env.DEV && new URLSearchParams(window.location.search).has('bareTank');
  const directViewsOnly: Object3D[] = [];
  const clearReflectionsOnly: Object3D[] = [];
  if (!isBareTank) {
    const [hardscape, plants, plantScans] = await Promise.all([loadHardscape(), loadPlants(), loadPlantScans()]);
    addToContents(contents, hardscape);
    addToContents(contents, plants);
    addToContents(contents, plantScans);
    directViewsOnly.push(plants);
    clearReflectionsOnly.push(hardscape, plantScans);
    const particles = createParticles(caustics);
    const bubbles = createBubbles(AIR_STONE);
    addToContents(contents, particles);
    addToContents(contents, bubbles);
    directViewsOnly.push(particles, bubbles);
  }
  addToContents(contents, createTankInterior());

  const fishEnvironment = await loadEnvironment();
  const leafCells = await loadLeafCells();
  let plantBumps: readonly PlantBump[] = [];
  const fishMeshes = await Promise.all(
    (Object.entries(POPULATION) as [SpeciesId, number][])
      .filter(([, count]) => count > 0 && !isBareTank)
      .flatMap(([species, count]) => {
        const skins = SPECIES[species].assetNames;
        return skins.map(async (name, skin) => ({
          species,
          skin,
          skins: skins.length,
          mesh: createFishMesh(await loadFishAsset(name), species, Math.floor((count + skins.length - 1 - skin) / skins.length)),
        }));
      }),
  );
  for (const { mesh } of fishMeshes) {
    addToContents(contents, mesh.object);
    clearReflectionsOnly.push(mesh.object);
  }
  let elapsedSeconds = 0;
  let simulation: SimState = createInitialState(SIMULATION_SEED, POPULATION, fishEnvironment);
  let fish: readonly FishState[] = isBareTank ? [] : simulation.fish;
  let smoothedFocus = DEFAULT_FOCUS_METRES;
  let frameNumber = 0;
  let drawnLastFrame = { triangles: 0, drawCalls: 0 };
  renderer.info.autoReset = false;

  const pipeline = createImagePipeline(renderer, camera);
  const depthPunch = createDepthPunch();
  let focusOverride: number | null = null;

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    const pixelRatio = renderer.getPixelRatio();
    pipeline.resize(Math.floor(window.innerWidth * pixelRatio), Math.floor(window.innerHeight * pixelRatio));
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', resize);
  resize();

  let frames: FrameWindow = emptyFrameWindow;
  let frozenAt: number | null = null;
  let lastMilliseconds = performance.now();

  if (import.meta.env.DEV) {
    const api: TankDebugApi = {
      setView: (view) => {
        // The close-up goes to a real angelfish, wherever it has swum; the highest one is clear of the plants.
        const hero = fish.filter((state) => state.species === 'angelfish').sort((a, b) => b.position[1] - a.position[1])[0];
        if (view === 'angelfish-closeup' && hero !== undefined) {
          rig.jumpToPose({ azimuthDegrees: 0, eyeHeight: hero.position[1] + 0.02, distanceToGlass: 0.25, pivotX: hero.position[0] });
        } else {
          rig.jumpToView(view);
        }
      },
      setPose: rig.jumpToPose,
      eye: (): Vec3 => [camera.position.x, camera.position.y, camera.position.z],
      projectToScreen: ([x, y, z]: Vec3): Vec2 => {
        const projected = new Vector3(x, y, z).project(camera);
        return [((projected.x + 1) / 2) * window.innerWidth, ((1 - projected.y) / 2) * window.innerHeight];
      },
      addToContents: (object: Object3D): void => addToContents(contents, object),
      surfaceStats: surface.readStats,
      jumpTimeTo: (seconds: number): void => {
        elapsedSeconds = seconds;
      },
      largestTimeUniform: (): number => Math.max(surface.largestTimeValue(), breathPhase.value as number, plantPhase.value as number, waterTime.value as number),
      fishPositions: (): readonly Vec3[] => fish.map((state) => state.position),
      setFocusDistance: (metres: number): void => {
        focusOverride = metres;
      },
      freezeAt: (seconds: number): void => {
        frozenAt = seconds;
        elapsedSeconds = seconds;
      },
      frameStats: () => summarizeFrames(frames, 'webgpu'),
      drawnLastFrame: () => drawnLastFrame,
      shakeLeavesAt: (position: Vec3): void => {
        plantBumps = [{ position, direction: [1, 0, 0], strength: 1, ageSeconds: 0 }];
        setPlantBumps(plantBumps);
      },
      plantBumpCount: () => plantBumps.length,
      resetFrameStats: (): void => {
        frames = { seconds: [], frameCount: frames.frameCount };
      },
      loseDevice: () => device.destroy(),
      distanceToGlass: rig.distanceToGlass,
      azimuthDegrees: rig.azimuthDegrees,
    };
    window.__tank = api;
  }

  await renderer.setAnimationLoop(() => {
    drawnLastFrame = { triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.drawCalls };
    renderer.info.reset();
    const now = performance.now();
    const frameSeconds = (now - lastMilliseconds) / 1000;
    lastMilliseconds = now;
    frames = addFrame(frames, frameSeconds);
    const simulationSeconds = frozenAt === null ? Math.min(frameSeconds, MAX_FRAME_SECONDS) : 0;
    rig.update(simulationSeconds);
    surface.update(simulationSeconds);
    caustics.update();
    frameNumber += 1;
    tankLight.shadow.needsUpdate = frameNumber % SHADOW_UPDATE_EVERY_FRAMES === 0;
    elapsedSeconds += simulationSeconds;
    if (!isBareTank) {
      simulation = stepSimulation(simulation, simulationSeconds, fishEnvironment);
      fish = simulation.fish;
      // A paused world disturbs nothing, though fish still hold their last velocity.
      if (simulationSeconds > 0) plantBumps = updatePlantBumps(plantBumps, fish, leafCells, simulationSeconds);
      setPlantBumps(plantBumps);
      for (const { species, skin, skins, mesh } of fishMeshes) {
        mesh.update(fish.filter((state) => state.species === species).filter((_, index) => index % skins === skin), simulationSeconds);
      }
    }
    breathPhase.value = (elapsedSeconds * BREATHS_PER_SECOND * 2 * Math.PI) % (2 * Math.PI * 64);
    plantPhase.value = (elapsedSeconds * PLANT_SWAYS_PER_SECOND * 2 * Math.PI) % (2 * Math.PI * 64);
    waterTime.value = elapsedSeconds % WATER_TIME_WRAP_SECONDS;
    waterFrameSeconds.value = simulationSeconds;
    smoothedFocus += (focusDistanceFor(camera, fish) - smoothedFocus) * (1 - Math.exp(-FOCUS_DAMPING_PER_SECOND * frameSeconds));
    pipeline.setFocusDistance(focusOverride ?? smoothedFocus);
    pipeline.render(() => {
      renderer.render(room.behind, camera);
      renderer.render(depthPunch, camera);
      renderPortals({ renderer, contents, camera, directViewsOnly, clearReflectionsOnly });
      renderer.render(room.front, camera);
      renderer.render(shellScene, camera);
    });
  });
};

start().catch((error: unknown) => {
  showFatalError(error instanceof Error ? error : new Error(`Startup failed: ${String(error)}`));
  throw error;
});
