# Fish behaviour, deeper tank, and larger room review

Compare `wide-room.png` and `front-tank.png` with `reference-photo.png`. The room now follows the owner's requests rather than the photo's proportions.

## Changed

- **Tank:** 100 cm deep, up from 70, and centred in the room.
- **Room:** 5.2 m wide, up from 3.6, and about 1.3 m longer. The sofa and TV stand further from the tank. The potted plant is gone.
- **Fish:** 132 in total: 5 angelfish, each a different colour (silver, gold, platinum, blue, koi), 1 discus, 6 gouramis, 72 tetras, 16 tiger barbs, 14 platies, 12 corydoras, and 6 otocinclus.
- **Behaviour:** each fish or school keeps to a home area and makes short trips across the tank, front to back as well as along it. Fish swim in bursts and glides, at lower speeds, and rest near cover.
- **Leaves:** they shake and settle when a fish pushes through them. Only a small core of each plant mass still blocks fish.
- **Skin:** the gold angelfish is repainted without the silver fish's bars, and streaks on surfaces turned away from the photo are softened.

## Measured

Mid-water fish over five simulated minutes in the real tank (`tests/fishRoaming.test.ts`):

| Measure | Before | Limit |
| --- | --- | --- |
| Time in the middle third of the tank | 59% | under 55% |
| Time in each outer third | one at 18% | over 20% |
| Median tetra speed | 0.12 m/s | under 0.1 m/s |
| Time resting | 0% | over 15% |
| Resting within 30 cm of cover or the ground | no resting | over 70% |
| Time hidden behind wood or plants | 0.02% before the previous round | over 8% |

All pass now. Leaf shake on screen, averaged over frames: change of about 12 against noise of 0.4 at 7.5 cm strength, and 0.48 against 0.48 with the shake off. Final strength is 5.5 cm, with a change of 10.77 against noise of 0.34.

## Tests

60 of 60 unit tests and 18 of 18 browser tests pass. Front view: 5.44 M triangles against a 6 M budget. `tests/performance.spec.ts` passed 3 of 3 runs with Brave idle, averaging 99.6-100 fps at every view. One single frame fell to 34.5 fps at the underside view, on one run; the slowest 1% there was 63.7 fps.

## Not checked

- Fish motion was measured by tests and seen only in still captures, not watched as moving video.
- The streak softening was not examined on a fish facing the viewer directly.

## Still looks wrong

Most serious first.

1. **Painted angelfish up close.** The gold, platinum, blue, and koi are flatter and less convincing than the photo-skinned fish.
2. **Angelfish filaments** are thin, straight, and rigid.
3. **Fish pass through leaves.** Leaves shake, but they do not physically block a fish.
4. **Upper right bush** is less dense and less bright than the reference photo.
5. **High leaves up close** still look too lime and flat.
6. **Plant species.** Land plants stand in for aquatic ones.
7. **Room.** The sofa has few real creases, the TV picture is still, and the back wall is plain.
