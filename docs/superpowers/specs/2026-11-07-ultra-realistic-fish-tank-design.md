# Ultra-Realistic 3D Fish Tank: Design

## Intent

A live, real-time 3D scene, built with the latest three.js, of a home aquarium in
a living room. The owner's one firm requirement is that everything is ultra
realistic: the room, the aquarium, the things inside it, and the fish. Realism is
the product. There is no other feature to fall back on if it does not look real.

The owner set the living room, the subject, and the realism bar, then asked the
author to decide the rest and approved the concept below. Choices marked
"author's call" can still be changed by the owner.

## The scene (author's call, approved in concept)

**Time and room.** A living room in the evening, following the owner's photo
`reference/room/inspiration.png`: grey-green walls, a warm ceiling, wood panels with an
LED strip on the left, a TV on a black console, a large grey sectional in the foreground,
a pale wood floor, and curtains on the right. The room stays dim, and the tank is by far
the brightest thing in it.

**Aquarium.** Rimless glass tank, 300 x 100 x 135 cm (owner's decision, following
`reference/room/inspiration.png`), on a low, matte, taupe cabinet, with a black hood and
a white-hot LED bar on top, and a discreet filter inlet and outlet. Modelled at real
scale in metres.

**Inside.** A lush freshwater planted aquascape following the owner's image
`reference/aquascape/inspiration.png`: long sweeping driftwood, craggy rocks, tall plants
at both ends, open water in the upper middle, a low foreground, a strip of pale sand along
the front, a lit blue-teal background, and a curtain of bubbles.

**Fish.**

| Species | Count | Adult size | Behaviour that must read as real |
| --- | --- | --- | --- |
| Cardinal-coloured tetra, enlarged to match the photo | ~72, in two schools | 8.5 cm | Schools tightly, scatters and regroups |
| Tiger barb | ~16 | 9 cm | Fast school, low in the tank |
| Platy | ~14 | 8.5 cm | Loose school, high in the tank |
| Freshwater angelfish | 5, each its own variety: silver, gold, platinum, blue, koi; enlarged to match the photo | 20 cm | Drifts, hovers, turns slowly; a hero fish |
| Discus | 1 | 20 cm | Slow, stately drifter; a hero fish |
| Dwarf gourami | 6 | 12 cm | Drifts alone, high in the tank |
| Corydoras catfish | ~12 | 7.5 cm | Roots along the bottom, darts up for air and back |
| Otocinclus catfish | ~6 | 5.5 cm | Clings to and grazes on glass and leaves |

Mid-water fish keep to home areas across the tank, swim in bursts and glides, cross it front to back as well as along it, rest near cover, and regularly pass behind wood and rock. Leaves shake when a fish pushes through them (owner's requests).

## Realism requirements

Each of these must be visible in the finished scene.

- **Light in water:** moving caustics on sand, stone, plants, and fish; soft light
  shafts; slight haze and colour loss with distance through water.
- **Water surface:** moving surface, with a mirror-like underside from total
  internal reflection when seen from below through the front glass.
- **Glass and water optics:** refraction that visibly shifts objects at the
  air-glass-water boundary, mirror-like reflections on side panes at glancing
  angles, faint room reflections on the front glass.
- **Life in the water:** drifting particles, rising bubbles from the outlet,
  plants moving with the current.
- **Fish bodies:** body and fin motion driven by swimming speed, translucent fins,
  iridescent scales where the species has them (the cardinal tetra's neon stripe
  must shimmer with viewing angle).
- **Fish behaviour:** obstacle and glass avoidance, no intersections with the
  scene, no identical synchronised motion, no visible animation loops.
- **Camera:** depth of field, film-like tone mapping, stable image without
  shimmering edges.

## Constraints

- **Stack:** three.js 0.187.0 (latest at time of writing, verified on npm) with
  `WebGPURenderer` and TSL. The package ships SSR, GTAO, god rays, depth of field,
  TRAA, motion blur, upscaling, `MeshPhysicalNodeMaterial`, `MeshSSSNodeMaterial`,
  and `VolumeNodeMaterial`. Official examples worth reading first:
  `webgpu_caustics`, `webgpu_volume_caustics`, `webgpu_backdrop_water`,
  `webgpu_refraction`, `webgpu_compute_birds`, `webgpu_skinning_instancing_individual`.
- **Target machine:** the owner's Mac (Apple M4 Max, 40-core GPU, 48 GB RAM) in
  Chrome on a 3440 x 1440 display. Internal upscaling is acceptable if the result
  stays sharp.
- **Frame rate vs realism (author's call):** realism wins. Target an average of
  60 fps in normal viewing, and accept dips in close-ups as long as frame rate
  stays above 40 fps across the slowest 1% of frames (owner's decision). Choose accurate optics and detailed assets first, and spend
  performance work to protect those choices rather than simplifying them away.
- **Camera range (author's call):** a smooth, limited orbit around the front of
  the tank, up to about 75 degrees either side so the side panes can be seen, and
  from about 3 m down to 25 cm from the glass. The tank stands against a wall, so
  its back is never seen. The room is fully built only where this range can see it,
  with a simple stand-in behind the viewer for reflections in the glass. Every fish
  species must hold up at the closest distance, with level-of-detail switching where
  it cannot be seen.
- **Missing WebGPU:** show a clear error. No silent WebGL fallback (`WebGPURenderer`
  falls back by default, so this must be checked explicitly).
- **Code style:** follow the owner's global rules in `~/.claude/CLAUDE.md`
  (functional, strict typing, no default parameters, explicit errors, no fallbacks).
- **Git:** the folder is not a git repo yet. Do not commit unless the owner asks.

## Assets

Asset quality decides whether this succeeds, and it is the largest open risk.

Research on 2026-11-07, from search listings only (nothing inspected or bought):

- **Fish:** no free scan or CC0 model was found for any of the four species. A
  Sketchfab listing for a rigged *Pterophyllum altum* angelfish (a close relative)
  turned up, with its license unconfirmed.
- **Plants:** no free aquarium plant scans were found. Candidates need a further search.
- **Hardscape and room:** Poly Haven (CC0) has rocks, wood, textures, and HDRIs,
  suitable for stone, driftwood, floor, rug, and room materials. Confirm specific
  assets during planning.

Rules (owner's decisions):

- **The asset budget is zero.** Nothing gets bought. Anything not available free
  gets built from scratch.
- **The app stays on the owner's Mac,** so licenses only need to allow personal,
  local use. Going public later would mean rechecking every asset.

Approach (author's call):

- The fish and aquarium plants are expected to be built from scratch: modelled and
  rigged in Blender (installed, and scriptable headless), textured with procedural
  and hand-authored maps, and exported to glTF. A free model may replace a from-scratch
  one if it is better and its license allows personal use.
- Real photos guide shape, proportion, and colour. A photo is used directly as a
  texture only if its license allows it.
- Every asset's source and license is recorded in a single `ASSETS.md` file.

**Known consequence:** this is the option most likely to miss "ultra realistic" in
close-ups. The first milestone tests it directly with the angelfish at the 25 cm
closest camera distance. If that does not look real after a serious attempt, the
builder stops and reports to the owner, who decides whether to keep going, limit how
close the camera gets, or reconsider the budget. The builder does not quietly lower
the bar.

## Goals

- A viewer's first reaction on opening it is that it looks like a real tank.
- It holds up while moving the camera and watching for several minutes.

## Non-goals (author's call)

- No game mechanics, scoring, feeding, or fish-care simulation.
- No menus or settings UI beyond what is needed to look around.
- No sound.
- No phone, tablet, or low-end hardware support.
- No camera inside the water. The viewer stays in the room, outside the glass.
- No public hosting. It runs only on the owner's Mac (owner's decision).

## Anti-goals

These count as failure even if the code works.

- Cartoon, toy, or video-game look.
- Fish that visibly loop, move in sync, swim through plants, or pass through glass.
- A tank that looks like a box with a blue tint, or glass that looks like nothing is there.
- Caustics or god rays turned up so far that they look like an effect.

## How realism gets judged

Realism has to be checked by eye, so the builder should:

- Fix a set of about five camera views, from wide room to close-up on an angelfish,
  and capture them from the real app in the real browser at every milestone.
- Compare those views side by side with real reference photos of planted tanks and
  of each species, and record what still looks wrong.
- The owner has the final word on whether it looks real.

Build order and review (author's call):

- The first milestone is one angelfish in one corner of the tank with real water,
  glass, and caustics. The owner reviews it before the rest gets built, because it
  tests the asset approach and the rendering together while they are cheap to change.
- Priority if effort runs short: angelfish, glass and water, tetras, aquascape, room,
  then the two catfish species.
- The owner reviews at each later milestone and decides when it is finished.

Automated checks are limited to a smoke test: the app loads, renders with WebGPU,
logs no console errors, and stays above the 40 fps floor on the target machine.

## Left to the builder

- Project tooling, file layout, and build setup.
- Rendering techniques for caustics, water surface, refraction, and light shafts,
  provided the realism requirements are met.
- How fish are animated (skeletons, vertex shaders, or both) and how the schooling is
  simulated, provided the behaviour requirements are met.
- Exact plant species and layout, and exact fish variety (e.g. silver or marble
  angelfish).
