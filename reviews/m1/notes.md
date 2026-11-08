# Milestone 1 review: one angelfish in real water

Captured views are in this folder. `reference-photo.jpg` is the photo the fish was traced from. Compare it with `angelfish-closeup.png`.

## Holds up against real tanks

- Refraction through the glass, mirror images in the side panes and the underside of the surface, and objects doubling across the corner. Marker positions are within 4 pixels of the physics.
- Moving caustics computed from a real wave simulation, not a pattern texture.
- Colour loss with distance, faint light shafts, and dark water.
- Scales that catch the light individually.
- Frame rate: a steady 100 fps at every view, the monitor's limit, with plenty left for the rest of the scene.

## Still looks wrong

Most serious first.

1. **Fish skin at 25 cm reads as an illustration.** The scale pattern is too even and too worm-like, and coloured iridescent speckle on the belly looks like noise. Real silver is a smooth mirror-like sheen with scales only just visible.
2. **Eye.** The ring of the iris is too clean and too saturated, and the eye looks stuck on. It lacks the depth and wetness of the real thing.
3. **Fins.** They read as stiff pleated sheets. Real fins are soft and thinner at the edges, with irregular outlines, and rays that branch and curve.
4. **Body shape.** Cleaner and more symmetrical than a living fish, with too little modelling around the head, throat, and belly.
5. **Ventral fins.** One thin ribbon, where the real fish has two long, curving filaments.
6. **Empty tank.** Dark water with bare sand is unforgiving. Plants, wood, and a lit room are planned and will help the whole picture, but they will not fix the fish at 25 cm.
7. **Glass and top of tank.** Reflections are placeholders until the room exists in milestone 4.

## At normal viewing distance

From about 1 m (`front-tank.png`), the fish is much more believable, because skin detail is too fine to judge.
