# Ultra-Realistic Fish Tank Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live WebGPU scene of a planted freshwater aquarium in an evening living room, realistic enough that the owner accepts it as looking like a real tank.

**Architecture:** The tank contents render several times per frame, once per visible "portal" (front pane, side pane, top surface, and mirror images from total internal reflection), with analytic refraction in the vertex stage so nothing depends on screen-space data. Fish and plants are built from scratch by Blender Python scripts and animated procedurally in TSL from a pure TypeScript simulation. The room is baked in Blender Cycles.

**Tech Stack:** three 0.187.0 (`three/webgpu`, `three/tsl`), TypeScript 7, Vite 8, Vitest 5, Playwright 1.65 (real Chrome), `@gltf-transform/core` and `@gltf-transform/cli` 4.5, Blender at `/Applications/Blender.app/Contents/MacOS/Blender` (installed version is 5.4.0 Alpha).

**Spec:** `docs/superpowers/specs/2026-11-07-ultra-realistic-fish-tank-design.md`

## Global Constraints

- Tank is 120 x 45 x 50 cm, rimless glass, modelled at real scale in metres.
- Fish counts: ~30 cardinal tetra, 2 angelfish, ~6 corydoras, ~4 otocinclus.
- Camera stays outside the glass: orbit up to 75 degrees either side of the front, 3 m down to 25 cm from the glass, never behind the tank.
- Target machine is an M4 Max in Chrome at 3440 x 1440. Average 60 fps in normal viewing; stays above 40 fps in close-ups. Realism wins over frame rate.
- Missing WebGPU shows a clear error. No WebGL fallback.
- The asset budget is zero. Nothing gets bought. Licenses need only allow personal, local use; every asset is recorded in `ASSETS.md`.
- Runs only on the owner's Mac. No public hosting, sound, game mechanics, settings UI, or phone support.
- Follow `~/.claude/CLAUDE.md`: functional style, pure functions, strict types, no default parameters, no flag parameters, explicit specific errors, no fallbacks, comments in English. Scene-graph and GPU mutation stays at the render boundary (`src/main.ts` and per-frame update functions).
- **No git steps.** The owner's rules override the usual commit steps: do not `git init` or commit unless the owner asks.
- Tests are smoke and integration tests against real code and a real GPU, with no mocks. UI tests use `data-testid`. Do not test static config.
- A visual task is finished only after its views are captured and compared with reference photos, with what still looks wrong written to `reviews/<milestone>/notes.md`. **Passing tests alone do not make a visual task finished.**
- **At each OWNER REVIEW gate, stop and wait for the owner's response.**

## Review Focus

1. Left running for hours or days as a living-room piece: motion stays smooth, with no jitter from float precision in time values. Test in Task 7.
2. Tab hidden for minutes, then shown again: fish continue from a valid state, with no teleporting, tunnelling, or simulation blow-up. Test in Task 8.
3. Window resized or moved between displays: image stays sharp and correctly proportioned, and all render targets follow. Test in Task 5.
4. Rapid scrolling, dragging, or trackpad flinging: camera never passes the limits or enters the glass. Test in Task 1.
5. Mac sleeps and the GPU device is lost: page shows a clear error telling the viewer to reload, not a frozen frame. Test in Task 1.

---

## File Structure

```
index.html, package.json, tsconfig.json, vite.config.ts, playwright.config.ts
ASSETS.md                         source and license of every asset
reference/<subject>/              reference photos, used for comparison only
reviews/<milestone>/              captured views and notes.md
tools/blender/                    headless asset scripts, one per asset family
public/assets/                    generated glTF, textures, bakes
src/main.ts                       startup and frame loop
src/app/                          bootstrap.ts, errorOverlay.ts, debugApi.ts, frameStats.ts
src/camera/cameraRig.ts           limited orbit camera and review views
src/tank/                         dimensions.ts, refraction.ts, refractionNodes.ts, portals.ts, tankShell.ts
src/water/                        surface.ts, caustics.ts, volume.ts, particles.ts, bubbles.ts
src/render/pipeline.ts            MRT, AO, depth of field, TRAA, tone mapping
src/fish/                         species.ts, simulation.ts, behaviours.ts, swimNodes.ts, fishMesh.ts, fishMaterial.ts
src/aquascape/                    layout.ts, colliders.ts, plants.ts, plantNodes.ts, hardscape.ts
src/room/room.ts                  baked room and reflection environment
tests/                            *.test.ts (Vitest), *.spec.ts (Playwright), fixtures in tests/fixtures/
```

## Shared decisions

Starting values in `src/tank/dimensions.ts`, exported as `TANK`. All values are metres. Those not pinned by the spec are the plan's choices.

| Name | Value | Note |
| --- | --- | --- |
| `width` / `depth` / `height` | 1.2 / 0.45 / 0.5 | Spec |
| `glassThickness` | 0.012 | |
| `standTopY` | 0.75 | Cabinet top; tank bottom sits here |
| `waterSurfaceY` | 1.22 | 3 cm below the 1.25 rim |
| `wallZ` | -0.26 | Back of tank is at z = -0.225, with black backing film |
| `frontPaneZ` | 0.225 | |
| `iorWater` / `iorGlass` | 1.333 / 1.517 | |

Water absorption starts at R 0.45, G 0.07, B 0.04 per metre, plus a small scattering term for haze, tuned by eye against reference photos.

The five review views, as type `ReviewView`: `wide-room`, `front-tank`, `side-glancing`, `underside-surface`, `angelfish-closeup`.

Shared types live in `src/tank/dimensions.ts`: `Vec2 = readonly [number, number]`, `Vec3 = readonly [number, number, number]`, and `Plane3 = { readonly normal: Vec3; readonly constant: number }`. `FloatNode`, `Vec2Node`, and `Vec3Node` are aliases for the matching TSL node types. Any other type named in an Interfaces block (such as `PortalRenderContext` or `LoadedRoom`) is defined in the file that produces it, holding only the fields its consumers use. `SpeciesParams` has at least `bodyLength`, `maxSpeed`, and `swimFrequency`.

---

## Milestone 0: Foundation

### Task 1: App shell, WebGPU guard, camera, and capture tooling

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `playwright.config.ts`, `index.html`, `ASSETS.md`, `src/main.ts`, `src/app/bootstrap.ts`, `src/app/errorOverlay.ts`, `src/app/debugApi.ts`, `src/app/frameStats.ts`, `src/camera/cameraRig.ts`, `src/tank/dimensions.ts`
- Test: `tests/smoke.spec.ts`, `tests/camera.spec.ts`, `tests/deviceLost.spec.ts`, `tests/captureViews.spec.ts`

**Interfaces:**
- Produces: `createRenderer(canvas: HTMLCanvasElement): Promise<WebGPURenderer>` throws `WebGPUUnavailableError`; `showFatalError(error: Error): void` renders into `data-testid="fatal-error"`; `createCameraRig(camera: PerspectiveCamera, canvas: HTMLCanvasElement): CameraRig`; `CameraRig = { update(dt: number): void; jumpToView(view: ReviewView): void; distanceToGlass(): number; azimuthDegrees(): number }`; dev-only `window.__tank: TankDebugApi = { setView(view: ReviewView): void; freezeAt(seconds: number): void; frameStats(): FrameStats; loseDevice(): void }`; `FrameStats = { averageFps: number; minimumFps: number; backend: 'webgpu' | 'webgl' }`; `TANK`.

- [ ] **Step 1: Install pinned dependencies**

Run: `npm init -y && npm pkg set type=module && npm i three@0.187.0 && npm i -D typescript@7.0.2 vite@8.3.6 vitest@5.1.0 @playwright/test@1.65.0 @types/three@0.187.0 @gltf-transform/core@4.5.1 @gltf-transform/cli@4.5.1`
Expected: exits 0.

`playwright.config.ts` uses `channel: 'chrome'`, `headless: false`, viewport 3440 x 1440, and runs against the Vite dev server. The window must stay visible during frame-rate tests.

- [ ] **Step 2: Write the failing tests**

```ts
// smoke.spec.ts: test('renders with WebGPU and no console errors')
expect(consoleErrors).toEqual([]);
expect((await frameStats(page)).backend).toBe('webgpu');
await expect(page.getByTestId('app-canvas')).toBeVisible();

// smoke.spec.ts: test('shows a clear error without WebGPU'), navigator.gpu removed by addInitScript
await expect(page.getByTestId('fatal-error')).toContainText('WebGPU');

// camera.spec.ts: test('camera stays inside its limits under rapid input')
// 200 wheel events each way and 100 hard drags each way
expect(await distanceToGlass(page)).toBeGreaterThanOrEqual(0.25);
expect(await distanceToGlass(page)).toBeLessThanOrEqual(3);
expect(Math.abs(await azimuthDegrees(page))).toBeLessThanOrEqual(75);

// deviceLost.spec.ts: test('lost GPU device shows a reload message')
await page.evaluate(() => window.__tank.loseDevice());
await expect(page.getByTestId('fatal-error')).toContainText('reload');
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx playwright test tests/smoke.spec.ts tests/camera.spec.ts tests/deviceLost.spec.ts`
Expected: FAIL, because the app does not exist.

- [ ] **Step 4: Implement the shell and guard**

`createRenderer` checks `WebGPU.isAvailable()` from `three/addons/capabilities/WebGPU.js`, awaits `renderer.init()`, then throws `WebGPUUnavailableError` unless `renderer.backend.isWebGPUBackend === true`, because `WebGPURenderer` silently falls back otherwise. Set `renderer.onDeviceLost` to call `showFatalError`.

- [ ] **Step 5: Implement `createCameraRig`**

Damped orbit around tank centre with eye height clamped to 0.95-1.45 m and clamps computed after damping. `distanceToGlass` measures to the nearest point on the outer tank box. Limit look direction so the back of the tank and the unbuilt part of the room stay out of frame. Fine-tune each `ReviewView` as content arrives; `angelfish-closeup` sits at exactly 0.25 m.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx playwright test tests/smoke.spec.ts tests/camera.spec.ts tests/deviceLost.spec.ts`
Expected: PASS.

- [ ] **Step 7: Add view capture**

`tests/captureViews.spec.ts` freezes at a fixed time and writes all five views to `reviews/$MILESTONE/<view>.png`.

Run: `MILESTONE=m0 npx playwright test tests/captureViews.spec.ts`
Expected: five PNG files exist.

---

## Milestone 1: One Angelfish in Real Water

This milestone tests the riskiest decisions together while they are still cheap to change: from-scratch fish, and portal optics.

### Task 2: Glass tank and analytic refraction

**Files:**
- Create: `src/tank/refraction.ts`, `src/tank/refractionNodes.ts`, `src/tank/portals.ts`, `src/tank/tankShell.ts`, `tests/fixtures/opticsFixture.ts`
- Test: `tests/refraction.test.ts`, `tests/optics.spec.ts`

**Interfaces:**
- Consumes: `TANK`, `CameraRig`, `TankDebugApi`.
- Produces: `solveRefractionCrossing(eye: Vec3, point: Vec3, plane: Plane3, iorRatio: number): Vec3`; `apparentPositionNode(eye: Vec3Node, worldPosition: Vec3Node, plane: PortalPlaneNodes): ApparentPositionNodes` returning `{ position, waterPathLength }`; `visiblePortals(eye: Vec3): readonly Portal[]`; `renderPortals(context: PortalRenderContext): void`; `createTankShell(): Group`. `Portal = { id: PortalId; plane: Plane3; corners: readonly Vec3[]; mirror: Plane3 | null }`; `PortalId = 'front' | 'side' | 'top' | 'surface-mirror' | 'side-mirror'`.
- Adds to `TankDebugApi`: `addToContents(object: Object3D): void` and `projectToScreen(world: Vec3): Vec2`. The test imports `/tests/fixtures/opticsFixture.ts` in the page through the Vite dev server and passes its objects to `addToContents`.
- All materials in the tank's contents get their `positionNode` from `apparentPositionNode`, with `castShadowPositionNode` set to the unrefracted position.

- [ ] **Step 1: Write the failing tests**

```ts
// refraction.test.ts: test('crossing obeys Snell law at the pane')
// sampled eyes, points, and incidence angles from 0 to 75 degrees
expect(sinIncident / sinRefracted).toBeCloseTo(1.333, 3);
expect(pathDerivativeAtCrossing).toBeCloseTo(0, 4); // Fermat's principle

// optics.spec.ts: test('submerged marker appears where refraction predicts')
// opticsFixture has an emissive red marker in the water; camera at 0 and 45 degrees
expect(distance2d(redCentroid(shot), projectedExpected)).toBeLessThan(4); // pixels
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/refraction.test.ts && npx playwright test tests/optics.spec.ts`
Expected: FAIL, functions undefined.

- [ ] **Step 3: Implement `solveRefractionCrossing` and `apparentPositionNode`**

Reduce to 2D in the plane holding eye, point, and pane normal, with eye height `a`, point depth `d`, and lateral separation `L`. Solve `f(x) = x / hypot(x, a) - n * (L - x) / hypot(L - x, d) = 0` with Newton iterations from `x0 = L * a / (a + n * d)`. Use the number of iterations needed to meet the 1e-3 tolerance at 75 degrees (start with 4), the same count in TypeScript and TSL. Place the apparent vertex along eye-to-crossing at distance `|eye-crossing| + |crossing-point| / n`, which preserves depth order. Export the water path length as a varying for the absorption in Task 4. Add the small lateral shift from pane thickness.

- [ ] **Step 4: Implement portals**

`visiblePortals` returns the front pane always, the camera-facing side pane once the eye is beyond the tank's side plane, the top when the eye is above `waterSurfaceY`, and the mirror portals when the eye is below it. `renderPortals` draws tank contents once per portal into one target, with autoClear off and depth shared. Each draw sits in a `ClippingGroup` whose planes form the frustum from eye through the portal's corners. Mirror portals reflect contents across `Portal.mirror`, which reproduces the mirror-like total internal reflection of a flat tank.

- [ ] **Step 5: Implement `createTankShell`**

Real glass details: pane geometry with thickness, polished edges with the green tint of real glass, silicone beads at corners, black backing film, faint dust and water marks, plus a plain placeholder cabinet replaced in Task 12. Panes use `MeshPhysicalNodeMaterial` with low-strength reflections only, since refraction is handled by the portals; a glass-to-air transmission pass would refract twice.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/refraction.test.ts && npx playwright test tests/optics.spec.ts`
Expected: PASS.

- [ ] **Step 7: Check the optics by eye**

Run: `MILESTONE=m1-optics npx playwright test tests/captureViews.spec.ts`
Expected: at `side-glancing` and `underside-surface`, the marker and a test checkerboard appear shifted and mirrored as in a real tank photo, with no seam at pane corners and no double image.

### Task 3: Moving water surface

**Files:**
- Create: `src/water/surface.ts`
- Modify: `src/tank/portals.ts`, `tests/fixtures/opticsFixture.ts`
- Test: `tests/surface.spec.ts`

**Interfaces:**
- Consumes: `Portal`, `renderPortals`.
- Produces: `createWaterSurface(renderer: WebGPURenderer): WaterSurface`; `WaterSurface = { update(dt: number): void; heightNode(worldXZ: Vec2Node): FloatNode; normalNode(worldXZ: Vec2Node): Vec3Node; mesh: Mesh }`.

- [ ] **Step 1: Write the failing test**

```ts
// surface.spec.ts: test('surface moves and mirrors the marker from below')
expect(meanPixelDifference(frameA, frameB, surfaceRegion)).toBeGreaterThan(0.5);
expect(redCentroidInRegion(undersideShot, predictedMirrorRegion)).not.toBeNull();
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/surface.spec.ts`
Expected: FAIL, surface does not exist.

- [ ] **Step 3: Implement `createWaterSurface`**

GPU height field by TSL compute (read the `webgpu_compute_water` example), on a grid of about 512 x 192. Disturbances come from the filter outlet position plus low-amplitude noise. Keep amplitude small (real still-tank ripples are millimetres). The surface perturbs the `surface-mirror` portal's lookup and shows Fresnel reflection from above, plus the meniscus line where water meets glass.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test tests/surface.spec.ts`
Expected: PASS.

### Task 4: Caustics, light, and water volume

**Files:**
- Create: `src/water/caustics.ts`, `src/water/volume.ts`
- Modify: `src/main.ts`
- Test: `tests/waterLight.spec.ts`

**Interfaces:**
- Consumes: `WaterSurface.normalNode`, `ApparentPositionNodes.waterPathLength`.
- Produces: `createCaustics(renderer: WebGPURenderer, surface: WaterSurface): Caustics`; `Caustics = { update(): void; causticsAtNode(worldPosition: Vec3Node, worldNormal: Vec3Node): Vec3Node }`; `absorptionNode(color: Vec3Node, waterPathLength: FloatNode): Vec3Node`; `createLightShafts(context: LightShaftContext): LightShafts`; `waterLitMaterialNodes(caustics: Caustics, pathLength: FloatNode): WaterLitNodes`, used by every submerged material.

- [ ] **Step 1: Write the failing test**

```ts
// waterLight.spec.ts: test('caustics move and distant objects lose red')
expect(meanPixelDifference(sandA, sandB, sandRegion)).toBeGreaterThan(1);
expect(redToBlueRatio(markerFar)).toBeLessThan(redToBlueRatio(markerNear));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/waterLight.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement caustics**

Render the surface's refracted grid to a half-float texture (about 1024 x 384) by the differential-area method: each vertex is refracted down to a receiver plane, and brightness is the ratio of original to projected triangle area. `causticsAtNode` projects along the refracted light direction, blurs with depth below the surface, offsets R, G, and B slightly, and fades on faces turned away from the light. The light is the LED bar on top, one shadow-casting `DirectionalLight` with soft PCF shadows. Do not use `webgpu_caustics`'s pattern-texture approach, because it would not match the surface.

- [ ] **Step 4: Implement the water volume**

`absorptionNode` is `color * exp(-coefficients * pathLength)`. Light shafts are a half-resolution raymarch through the tank box (16 steps with blue-noise jitter, resolved by TRAA), sampling shadow map and caustics, composited with scene depth. Keep them subtle: anti-goal in the spec.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx playwright test tests/waterLight.spec.ts`
Expected: PASS.

### Task 5: Camera-quality image pipeline

**Files:**
- Create: `src/render/pipeline.ts`
- Modify: `src/main.ts`
- Test: `tests/resize.spec.ts`

**Interfaces:**
- Consumes: `renderPortals`, `TankDebugApi`.
- Produces: `createImagePipeline(renderer: WebGPURenderer, camera: PerspectiveCamera): ImagePipeline`; `ImagePipeline = { render(contents: RenderContents): void; setFocusDistance(metres: number): void; resize(width: number, height: number): void }`.

- [ ] **Step 1: Write the failing test**

```ts
// resize.spec.ts: test('resizing keeps a correct, sharp image')
// 3440x1440 to 1280x720 to 1920x1080, with a known marker sphere in frame
expect(canvasPixelWidth(page)).toBe(viewportWidth * devicePixelRatio);
expect(markerAspectRatio(shot)).toBeCloseTo(1, 1);
expect(edgeSharpness(shot, sharpRegion)).toBeGreaterThan(sharpnessBaseline * 0.8);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/resize.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `createImagePipeline`**

Use `RenderPipeline`. Render portals to a multiple-render-target with colour, normal, and velocity. Chain: `ao` (GTAO) on room and hardscape, light shafts, `dof`, `traa`, then AgX tone mapping and a very light vignette and film grain. Confirm that velocity accounts for the camera-dependent refraction displacement; if not, write velocity from current and previous apparent positions. Autofocus on the point at screen centre with smoothing. Render targets follow `resize`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx playwright test tests/resize.spec.ts`
Expected: PASS, and no ghost trails behind moving objects in captured frames.

### Task 6: Angelfish model

**Files:**
- Create: `tools/blender/fish_body.py`, `tools/blender/fish_textures.py`, `tools/blender/build_angelfish.py`, `tools/blender/profiles/angelfish.json`, `reference/angelfish/`, `public/assets/fish/angelfish.glb`
- Modify: `ASSETS.md`
- Test: `tests/fishAssets.test.ts`

**Interfaces:**
- Produces: `angelfish.glb` at real scale, nose toward +X, with vertex colour `COLOR_0`: R is spine position (0 at nose, 1 at tail tip), G is fin-flex mask, B is pectoral mask, A is gill and mouth mask. Separate named meshes `body` and `eye`. Maps: base colour, normal, roughness, fin thickness, iridescence mask. Blender library: `build_fish_body(profile: dict) -> bpy.types.Object`, `bake_fish_textures(pattern: dict, size: int) -> dict[str, Path]`.

- [ ] **Step 1: Write the failing test**

```ts
// fishAssets.test.ts: test('angelfish asset meets the contract'), read with @gltf-transform/core
expect(bodyLength).toBeGreaterThanOrEqual(0.12);
expect(bodyLength).toBeLessThanOrEqual(0.15);
expect(meshNames).toEqual(expect.arrayContaining(['body', 'eye']));
expect(colorAttribute(body).max[0]).toBeCloseTo(1, 2);
expect(triangleCount(body)).toBeLessThanOrEqual(150_000);
expect(textureSize(baseColor)).toBe(4096);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/fishAssets.test.ts`
Expected: FAIL, file missing.

- [ ] **Step 3: Gather references**

Download at least 8 photos of *Pterophyllum scalare* (silver variety) from Wikimedia Commons into `reference/angelfish/`: side, front, three-quarter, and close-ups of fins, eye, and scales. Check each file's license and record it in `ASSETS.md`. Use them for proportion and colour. A photo is used directly as a texture only if its license allows it. Also check the Sketchfab *P. altum* listing; if its license allows personal use and it is better than what these scripts can produce, record that for the owner at the gate.

- [ ] **Step 4: Write the model scripts**

Trace the side outline and cross-sections from the photos into `profiles/angelfish.json`. `build_fish_body` lofts the compressed disc body and models each part: tall swept dorsal and anal fins with real fin rays and thin membrane, ventral filaments, pectoral fins, tail, mouth, nostrils, gill cover, and an eye with an iris, a pupil, and a cornea shell. Set the `COLOR_0` masks.

- [ ] **Step 5: Write the texture script**

Generate with NumPy inside Blender: overlapping cycloid scales that shrink toward head and fins, the lateral line, the four dark vertical bars with soft mottled edges, the silver base with subtle colour variation, and fin rays. Derive normal, roughness, and iridescence maps from the same scale height field, so they line up.

- [ ] **Step 6: Export and run the test**

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/build_angelfish.py -- --out public/assets/fish/angelfish.glb && npx vitest run tests/fishAssets.test.ts`
Expected: PASS. If the Blender alpha blocks a required feature or crashes, stop and tell the owner.

### Task 7: Swimming angelfish and first owner review

**Files:**
- Create: `src/fish/swimNodes.ts`, `src/fish/fishMesh.ts`, `src/fish/fishMaterial.ts`, `src/fish/species.ts`
- Modify: `src/main.ts`, `src/app/debugApi.ts`
- Test: `tests/angelfish.spec.ts`, `tests/longRun.spec.ts`, `tests/performance.spec.ts`

**Interfaces:**
- Consumes: `apparentPositionNode`, `waterLitMaterialNodes`, `angelfish.glb` contract.
- Produces: `SPECIES: Readonly<Record<SpeciesId, SpeciesParams>>`; `SpeciesId = 'angelfish' | 'cardinalTetra' | 'corydoras' | 'otocinclus'`; `swimDisplacementNode(attributes: FishAttributeNodes, instance: FishInstanceNodes, params: SpeciesParams): Vec3Node`; `createFishMesh(asset: LoadedFishAsset, species: SpeciesId, count: number): FishMesh`; `FishMesh = { update(fish: readonly FishState[]): void; object: InstancedMesh }`; `createFishMaterial(asset: LoadedFishAsset, nodes: WaterLitNodes): MeshSSSNodeMaterial`; `loadFishAsset(url: string): Promise<LoadedFishAsset>` in `src/fish/fishMesh.ts`, which throws `AssetLoadError` naming the URL and HTTP status, or the missing mesh name.
- Instance data is vec4 per fish: swim phase, swim amplitude, turn curvature, fin spread.

- [ ] **Step 1: Write the failing tests**

```ts
// angelfish.spec.ts: test('fish loads and animates; missing file names the file')
expect(meanPixelDifference(frameA, frameB, fishRegion)).toBeGreaterThan(1);
// with public/assets/fish/angelfish.glb blocked by page.route:
await expect(page.getByTestId('fatal-error')).toContainText('angelfish.glb');

// longRun.spec.ts: test('48 hours in, motion is still smooth')
await page.evaluate(() => window.__tank.freezeAt(172_800));
expect(await page.evaluate(() => window.__tank.largestTimeUniform())).toBeLessThan(4096);
expect(consoleErrors).toEqual([]);
```

Add `largestTimeUniform(): number` to `TankDebugApi`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test tests/angelfish.spec.ts tests/longRun.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `swimDisplacementNode`**

A travelling wave down the spine, with amplitude growing toward the tail and scaled by instance amplitude; bending along the spine by turn curvature; fin delay and fold, so fins trail the body; independent pectoral sculling; gill and mouth breathing. Keep shader time values wrapped so they never grow without bound: pass phases, not raw seconds.

- [ ] **Step 4: Implement `createFishMaterial`**

`MeshSSSNodeMaterial` with the baked maps. Fins are thin, transmitting light from behind using the thickness map. Scales get iridescence from the mask through `iridescenceNode` and `iridescenceThicknessNode`. Eyes get a clear, wet cornea with a sharp highlight.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx playwright test tests/angelfish.spec.ts tests/longRun.spec.ts`
Expected: PASS.

- [ ] **Step 6: Build the corner scene and capture**

One angelfish on a slow scripted path in one corner of the tank, with temporary sand from Poly Haven `coast_sand_01`, with water, glass, and caustics.

Run: `MILESTONE=m1 npx playwright test tests/captureViews.spec.ts`
Expected: all five views saved. Write a side-by-side comparison with references in `reviews/m1/notes.md`.

- [ ] **Step 7: Check the frame rate**

Add a `tests/performance.spec.ts` test that records 10 seconds at each view.
Run: `npx playwright test tests/performance.spec.ts`
Expected: `averageFps >= 60` in `front-tank` and `minimumFps > 40` in `angelfish-closeup`, with this one fish. Record the numbers; the budget left over must cover the rest of the scene.

- [ ] **Step 8: OWNER REVIEW: stop here**

Show the owner the running app and `reviews/m1/`. Ask whether the fish at 25 cm looks real. If not, after a serious attempt, the owner chooses: keep going, limit how close the camera gets, or reconsider the budget. **Do not start Milestone 2 without the owner's answer.**

---

## Milestone 2: Living School

### Task 8: Fish behaviour simulation

**Files:**
- Create: `src/fish/simulation.ts`, `src/fish/behaviours.ts`, `src/aquascape/colliders.ts`
- Test: `tests/simulation.test.ts`

**Interfaces:**
- Consumes: `SPECIES`, `TANK`.
- Produces:

```ts
type FishMode = 'cruise' | 'hover' | 'scatter' | 'surface' | 'root' | 'graze';
type FishState = { readonly species: SpeciesId; readonly position: Vec3; readonly velocity: Vec3;
  readonly swimPhase: number; readonly swimAmplitude: number; readonly turnCurvature: number;
  readonly finSpread: number; readonly mode: FishMode; readonly modeSeconds: number };
type SimState = { readonly fish: readonly FishState[]; readonly rngState: number };
type Collider = { readonly center: Vec3; readonly radius: number };
type SimEnvironment = { readonly colliders: readonly Collider[]; readonly grazeSurfaces: readonly GrazeSurface[] };
createInitialState(seed: number, environment: SimEnvironment): SimState;
stepSimulation(state: SimState, frameSeconds: number, environment: SimEnvironment): SimState;
distanceToNearestSolid(position: Vec3, environment: SimEnvironment): number;
```

`stepSimulation` is pure and advances at a fixed 1/60 s substep. A single call simulates at most 0.25 s, then continues from there, so a hidden tab resumes smoothly.

- [ ] **Step 1: Write the failing tests**

All run 10 simulated minutes at seed 1 with a test collider set.

```ts
test('no fish reaches glass or solids') // every substep, every fish
expect(distanceToNearestSolid(fish.position, env)).toBeGreaterThan(SPECIES[fish.species].bodyLength * 0.25);
test('tetras school, scatter, and regroup')
expect(shareOfSamples(medianNeighbourDistance, 0.02, 0.1)).toBeGreaterThan(0.85);
expect(scatterEvents).toBeGreaterThan(0);
expect(maxRegroupSeconds).toBeLessThan(30);
test('fish do not swim in sync')
expect(circularVariance(tetraSwimPhases)).toBeGreaterThan(0.5); // sampled once per second
test('angelfish drift and hover')
expect(meanSpeed(angelfish)).toBeLessThan(0.08);
expect(shareInMode(angelfish, 'hover')).toBeGreaterThan(0.25);
test('corydoras root and visit the surface')
expect(shareInMode(corydoras, 'root')).toBeGreaterThan(0.6);
expect(surfaceVisitsPerFish).toBeGreaterThanOrEqual(1);
test('otocinclus cling to surfaces')
expect(shareInMode(otocinclus, 'graze')).toBeGreaterThan(0.7);
test('five minute frame gap keeps every invariant')
const next = stepSimulation(state, 300, env);
expect(allPositionsFiniteAndClear(next, env)).toBe(true);
expect(maxPositionJump(state, next)).toBeLessThan(0.25 * maxSpeedOfAnySpecies);
test('input state is not mutated') // deep-frozen input does not throw
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/simulation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the simulation**

Boids-style steering with species-specific weights. Tetras: separation, alignment, cohesion within the shoal, plus an occasional startle which sets `scatter`. Add per-fish variation in size, swim frequency, and timing. Colliders and glass produce avoidance steering, plus a hard position clamp as the final invariant. `swimAmplitude` and swim frequency follow speed, so swimming visibly matches motion. `swimPhase` stays in the range 0 to 2 pi. Keep the simulation in a seeded RNG threaded through state.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/simulation.test.ts`
Expected: PASS.

### Task 9: Cardinal tetras in the tank

**Files:**
- Create: `tools/blender/build_cardinal_tetra.py`, `tools/blender/profiles/cardinal_tetra.json`, `reference/cardinal_tetra/`, `public/assets/fish/cardinal_tetra.glb`
- Modify: `src/main.ts`, `src/fish/species.ts`, `ASSETS.md`, `tests/fishAssets.test.ts`

**Interfaces:**
- Consumes: `build_fish_body`, `bake_fish_textures`, `createFishMesh`, `createFishMaterial`, `stepSimulation`.

- [ ] **Step 1: Add the failing asset test**

Length 0.03-0.04 m, at most 40,000 triangles, 2048 maps, same contract as Task 6.
Run: `npx vitest run tests/fishAssets.test.ts`
Expected: FAIL for the tetra.

- [ ] **Step 2: Build the asset and connect the simulation**

Translucent body, silver belly, red lower band, and a neon stripe whose blue-green shifts with viewing angle through `iridescenceNode`, and which must visibly shimmer as fish turn. Replace the angelfish's scripted path with `stepSimulation`; 2 angelfish and 30 tetras now run on it.

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/build_cardinal_tetra.py -- --out public/assets/fish/cardinal_tetra.glb && npx vitest run tests/fishAssets.test.ts`
Expected: PASS.

- [ ] **Step 3: Capture and check**

Run: `MILESTONE=m2 npx playwright test tests/captureViews.spec.ts tests/performance.spec.ts`
Expected: `reviews/m2/notes.md` compares with reference video stills and records any visible sync, looping, or popping. Frame-rate targets hold.

- [ ] **Step 4: OWNER REVIEW: stop here**

Show the owner the running app. Continue when they respond.

---

## Milestone 3: Aquascape

### Task 10: Substrate, hardscape, and colliders

**Files:**
- Create: `tools/blender/build_hardscape.py`, `src/aquascape/layout.ts`, `src/aquascape/hardscape.ts`, `public/assets/aquascape/hardscape.glb`, `public/assets/aquascape/colliders.json`
- Modify: `src/aquascape/colliders.ts`, `src/main.ts`, `ASSETS.md`
- Test: `tests/colliders.test.ts`

**Interfaces:**
- Produces: `parseColliders(json: object): SimEnvironment`, which validates the file's contents and throws `InvalidColliderFileError`; `loadColliders(url: string): Promise<SimEnvironment>`; `createHardscape(asset: LoadedHardscape, nodes: WaterLitNodes): Group`; `AQUASCAPE_LAYOUT`, plant positions used by Task 11.

- [ ] **Step 1: Write the failing tests**

```ts
// colliders.test.ts: test('colliders cover the hardscape, and fish still pass all sim invariants')
expect(everyHardscapeSampleInsideACollider).toBe(true);
expect(() => parseColliders({ colliders: [{ center: [0, 0] }] })).toThrow(InvalidColliderFileError);
// plus the Task 8 no-collision test, run against the real file
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/colliders.test.ts`
Expected: FAIL.

- [ ] **Step 3: Build the hardscape**

Download at 2K from Poly Haven (CC0): `root_cluster_01`, `root_cluster_02`, and `pine_roots` as driftwood (darkened, waterlogged look); `rock_07`, `rock_09`, and `boulder_01` as grey stone. Confirm they look right when loaded, and swap for other Poly Haven assets if not. Compose a nature-style layout with an off-centre focal point, open swimming space at the front, and height toward the back. Dark soil, fine sand foreground with a natural boundary, with small pebbles and mulm detail. Bake ambient occlusion to a second UV set. Export fitted sphere colliders.

- [ ] **Step 4: Run tests to verify they pass**

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/build_hardscape.py -- --out public/assets/aquascape && npx vitest run tests/colliders.test.ts`
Expected: PASS.

### Task 11: Plants, current, particles, and bubbles

**Files:**
- Create: `tools/blender/build_plants.py`, `reference/plants/`, `public/assets/aquascape/plants.glb`, `src/aquascape/plants.ts`, `src/aquascape/plantNodes.ts`, `src/water/particles.ts`, `src/water/bubbles.ts`
- Modify: `src/main.ts`, `src/aquascape/colliders.ts`, `ASSETS.md`
- Test: `tests/plants.spec.ts`

**Interfaces:**
- Consumes: `AQUASCAPE_LAYOUT`, `WaterLitNodes`, `apparentPositionNode`.
- Produces: `createPlants(asset: LoadedPlants, layout: AquascapeLayout, nodes: WaterLitNodes): Group`; `currentAtNode(worldPosition: Vec3Node): Vec3Node`; `createParticles(renderer: WebGPURenderer, currentAt: CurrentField): Points`; `createBubbles(renderer: WebGPURenderer, outlet: Vec3): Group`.

- [ ] **Step 1: Write the failing test**

```ts
// plants.spec.ts: test('plants move with the current, and particles and bubbles are alive')
expect(meanPixelDifference(frameA, frameB, stemRegion)).toBeGreaterThan(0.5);
expect(meanPixelDifference(frameA, frameB, bubbleRegion)).toBeGreaterThan(1);
expect(consoleErrors).toEqual([]);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/plants.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Build the plants**

Reference-led scripts with instanced leaves: a carpet (dwarf baby tears type), tall stems (rotala and ludwigia types), mid-ground broad leaves (cryptocoryne type), and anubias and java fern tied to the driftwood. Each leaf has procedural veins, colour variation, and imperfections such as slight holes, damaged edges, and light algae, which all stop leaves looking CG. Plants get a thin-surface material with light transmitted through leaves. The filter inlet and outlet are built in clear glass in this script too. Update `colliders.json` for dense stem clusters, which fish treat as soft obstacles.

- [ ] **Step 4: Add motion and life**

`currentAtNode` is a smooth flow field from the outlet, strongest near it. Sway grows with distance along each stem, with phase varying per plant. Particles: a few thousand tiny specks with TSL compute, following the current, lit by the same light and caustics, and defocused by depth of field. Bubbles: from the outlet, wobbling and rising, with small reflective shells.

- [ ] **Step 5: Run the test to verify it passes**

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/build_plants.py -- --out public/assets/aquascape/plants.glb && npx playwright test tests/plants.spec.ts`
Expected: PASS.

- [ ] **Step 6: Capture and check**

Run: `MILESTONE=m3 npx playwright test tests/captureViews.spec.ts tests/performance.spec.ts`
Expected: comparison with real planted-tank photos noted in `reviews/m3/notes.md`, including repetition checks. If plants cost too much frame time, add simplified far-leaf meshes rather than removing plants.

- [ ] **Step 7: OWNER REVIEW: stop here**

Show the owner the running app. Continue when they respond.

---

## Milestone 4: Living Room

### Task 12: Baked room and reflections

**Files:**
- Create: `tools/blender/build_room.py`, `public/assets/room/room.glb`, `public/assets/room/lightmap.exr`, `public/assets/room/reflection.exr`, `src/room/room.ts`
- Modify: `src/tank/tankShell.ts`, `src/main.ts`, `ASSETS.md`
- Test: `tests/room.spec.ts`

**Interfaces:**
- Produces: `createRoom(asset: LoadedRoom): Group`; `roomReflectionNode(worldDirection: Vec3Node): Vec3Node`, used by front and side panes; `createTankGlowOnFloor(caustics: Caustics): Mesh`.

- [ ] **Step 1: Write the failing test**

```ts
// room.spec.ts: test('camera sees no unbuilt room at any limit')
// at all four orbit and height extremes: no pixel of the clear colour
expect(shareOfPixelsMatching(shot, clearColor)).toBe(0);
// tank is the brightest object in wide view
expect(meanLuminance(shot, tankRegion)).toBeGreaterThan(meanLuminance(shot, wallRegion) * 3);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/room.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Build and bake the room**

Poly Haven (CC0): `sofa_02` or `sofa_03`, `modern_wooden_cabinet` or a modelled cabinet with `american_walnut_veneer` for the tank stand, `side_table_01`, `diagonal_parquet` or similar for the floor, plaster for the wall, plus a rug, and a lamp. Confirm each one in Blender first and record it in `ASSETS.md`. Lighting: low warm lamps and the tank as a cool area light. Bake direct and indirect light with Cycles to `lightmap.exr`. Render a 360-degree view from the normal viewing position to `reflection.exr`, the stand-in for reflections on the glass.

- [ ] **Step 4: Connect the room**

Static room uses baked light only. Add a live, faint reflection of the tank on the polished floor with `reflector`, and moving caustic glow on the floor in front of the tank from `createTankGlowOnFloor`, which is subtle. Replace the placeholder cabinet. Add the LED bar and the filter hardware outside the tank.

- [ ] **Step 5: Run the test to verify it passes**

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/build_room.py -- --out public/assets/room && npx playwright test tests/room.spec.ts`
Expected: PASS.

- [ ] **Step 6: Capture and check**

Run: `MILESTONE=m4 npx playwright test tests/captureViews.spec.ts tests/performance.spec.ts`
Expected: comparison with real evening photos of home aquariums noted in `reviews/m4/notes.md`. Frame-rate targets hold.

- [ ] **Step 7: OWNER REVIEW: stop here**

Show the owner the running app. Continue when they respond.

---

## Milestone 5: Finished Tank

### Task 13: Corydoras and otocinclus

**Files:**
- Create: `tools/blender/build_corydoras.py`, `tools/blender/build_otocinclus.py`, their `tools/blender/profiles/*.json`, `reference/corydoras/`, `reference/otocinclus/`, `public/assets/fish/corydoras.glb`, `public/assets/fish/otocinclus.glb`
- Modify: `src/main.ts`, `src/fish/species.ts`, `tests/fishAssets.test.ts`, `ASSETS.md`

**Interfaces:**
- Consumes: Task 6 Blender library, `createFishMesh`, `createFishMaterial`, `stepSimulation`, modes `root`, `surface`, and `graze` from Task 8.

- [ ] **Step 1: Add the failing asset tests**

Corydoras 0.05-0.06 m, otocinclus 0.03-0.04 m, each at most 60,000 triangles, 2048 maps, same contract as Task 6.
Run: `npx vitest run tests/fishAssets.test.ts`
Expected: FAIL for both.

- [ ] **Step 2: Build both species**

Corydoras: armoured bony plates instead of scales, barbels moving with the `A` mask, and sweeping bottom-rooting motion. Otocinclus: flattened underside and sucker mouth, with mottled brown and a dark side stripe, clinging to glass and leaves. On the front pane, they should be seen from below as real otos are.

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/build_corydoras.py -- --out public/assets/fish/corydoras.glb && /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python tools/blender/build_otocinclus.py -- --out public/assets/fish/otocinclus.glb && npx vitest run tests/fishAssets.test.ts tests/simulation.test.ts`
Expected: PASS.

### Task 14: Final realism and performance pass

**Files:**
- Modify: whatever files the review notes point to
- Update: `ASSETS.md`, `reviews/final/notes.md`
- Test: `tests/performance.spec.ts`, full suite

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Run the anti-goal review**

Run: `MILESTONE=final npx playwright test tests/captureViews.spec.ts`
Then watch the live app for 5 minutes, orbiting through all limits. In `reviews/final/notes.md`, check each spec anti-goal and each realism requirement with a pass or a specific problem. Include: toy look, fish loops or sync, clipping, box-with-blue-tint, invisible glass, and overdone caustics or god rays.

- [ ] **Step 2: Fix the problems found**

Fix in the spec's priority order: angelfish, glass and water, tetras, aquascape, room, catfish.

- [ ] **Step 3: Add level-of-detail switching where the profile needs it**

Only for fish meshes that cost more than the leftover budget in `tests/performance.spec.ts`. Switching must not be visible at the 25 cm closest view.

- [ ] **Step 4: Run everything**

Run: `npx tsc --noEmit && npx vitest run && npx playwright test`
Expected: all pass, with `averageFps >= 60` at normal views and `minimumFps > 40` everywhere.

- [ ] **Step 5: Confirm `ASSETS.md` is complete**

Every file in `public/assets/` and every texture source has a source and license line, with from-scratch work marked as such.

- [ ] **Step 6: OWNER REVIEW: final**

Show the owner the running app. They decide whether it is finished, or which notes to work on next.
