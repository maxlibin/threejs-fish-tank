# More fish, more species, and real swimming review

Compare `front-tank.png` with `reference-photo.png`.

## Changed

- 136 fish, up from 72, in nine varieties. New species: discus, dwarf gourami, tiger barb, and platy, built from licensed photos listed in `ASSETS.md`.
- Tetras swim in two schools; tiger barbs and platies each have their own.
- Mid-water fish use the tank's full height and depth, and aim for spots behind wood and rock. Blocked fish rise over obstacles, and fish stay nearly level instead of pointing straight up.
- Fins are truly translucent, and the tail no longer has a gap where it joins the body.
- Large fish use lighter meshes, and fish under 10 cm cast no shadow.

## Measured

Mid-water fish over five simulated minutes in the real tank (`tests/fishRoaming.test.ts`):

| Measure | Before | Limit | Now |
| --- | --- | --- | --- |
| Height range, 10th to 90th percentile | 0.36 m | above 0.5 m | passes |
| Depth range, 10th to 90th percentile | 0.30 m | above 0.3 m | passes |
| Time hidden behind wood or plants | 0.02% | above 8% | passes |

Triangles in the front view: 5.62 M, against 5.63 M before adding fish and a 6 M budget. A single draw of every fish went from 862,000 triangles to 388,000.

## Tests

43 of 43 unit tests pass. 16 of 17 browser tests pass. `tests/performance.spec.ts` failed both runs, with Brave busy (about 44% CPU in one process):

| View | Average fps | Slowest 1% |
| --- | --- | --- |
| Wide room | 60.2-62.1 | 45.9-46.9 |
| Front | 60.8-63.7 | 45.1-49.3 |
| Side | 57.7-89.7 | 40.9-68.0 |
| Underside | 71.6-80.5 | 27.3-55.8 |
| Close-up | 74.8-84.7 | 52.3-53.0 |

Measured again with Brave and Screen Studio closed: passed 3 of 3 runs. Averages were 97.7-100 fps at every view, where 100 looks like a cap. The lowest slowest-1% figure was 63.8 fps and the lowest single frame 41.8 fps, both at the underside view. So the failures above came from sharing the Mac with Brave, not from the new fish.

## Still looks wrong

Most serious first.

1. **Fish up close.** Both sides of a fish are the same photo, and a fish facing the viewer shows stretched skin. The gold angelfish still looks flat, with a dark smear through its eye.
2. **Angelfish filaments** are thin, straight, and rigid.
3. **Upper right bush** is less dense and less bright than the photo.
4. **High leaves up close** still look too lime and flat.
5. **Top-left glow** is dimmer than the photo.
6. **Plant species.** Land plants stand in for aquatic ones.
7. **Room.** The sofa has few real creases, and the TV picture is still.
