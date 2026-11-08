# Right bush rebuild review

Compare `front-tank.png` with `reference-photo.png`.

## Changed

- The big dark leaves on the right sit lower, topped by a crown of small, pale leaves from the Poly Haven periwinkle scan.
- The scan's flowers are removed. Its dead leaves and twigs are repainted green, and its colours are calmed to match the other plants.
- Fish avoid the new crown. All other plants, rocks, and wood are unchanged.

## Colour against the photo (sRGB)

Patches match `reviews/m14/notes.md`. Only the right-hand plants changed.

| Region | Photo | m14 | Now |
| --- | --- | --- | --- |
| Upper right plants | 154, 170, 81 | 93, 110, 50 | 89, 105, 47 |
| Lower right plants | 78, 83, 45 | 85, 93, 39 | 88, 97, 42 |

The upper-right average did not improve: the shape now resembles the photo, but dark water shows through the gaps in the crown, and the photo's bush is denser and paler.

## Tests

33 of 33 unit tests pass. `tests/aquascapeBounds.test.ts` confirms the new plants stay inside the glass. Triangles rose about 4%, to 5.63 M in the front view, within the 6 M budget.

`tests/performance.spec.ts` passed 1 of 3 runs. The other 16 browser tests passed. Brave was active during these runs, using up to about 54% CPU in one process.

| View | Average fps across runs | Lowest minimum fps |
| --- | --- | --- |
| Wide room | 58.5-100 | 12.6 |
| Front | 65.0-100 | 47.4 |
| Side | 60.8-96.9 | 42.6 |
| Underside | 69.4-99.6 | 36.0 |
| Close-up | 89.7-100 | 57.8 |

Measured again with Brave and Screen Studio closed: passed 1 of 3 runs. Averages were 76.2-100 fps at every view, above the 60 target. Both failures were single dips below the 40 fps floor: 39.4 at the side view and 37.9 at the close-up. The previous round passed 3 of 3 with Brave idle, lowest minimum 41.0, so the new plants may cost some frame rate, but the cause of these dips is not proven.

### Where the dips come from

Measured with other apps closed:

- **JavaScript is not the cause.** Over about 12,000 frames, the longest animation frame took 3.8 ms and the longest garbage collection 1.9 ms. Each of the 10 slow frames in that trace was one missed refresh (20 ms), with nothing over 4 ms on the main thread.
- **The new plants have no measurable steady cost.** With the frame cap removed, the views ran at 106-182 fps with new plants and 119-172 fps with old ones. The same new plants varied more between runs (front 124 and 113 fps) than new and old did from each other.
- **Likely mechanism.** The display refreshes at 100 Hz, so a frame has 10 ms. Typical frames take 5.5-9.4 ms and the slowest 1% take 7.6-12.1 ms, so an occasional frame misses a refresh and counts as 50 fps or lower.
- **Not reproduced.** The test's two failing dips (26 ms and 25 ms) did not recur in these traces, and the longest uncapped frame was 15.6 ms, so their exact cause is unproven.

### Slowest 1% check

Owner's decision: `tests/performance.spec.ts` now applies the 40 fps floor to the slowest 1% of frames, not the single slowest frame. With Brave open it passed 2 of 3 runs. The third run was a sustained slowdown (averages 55.3-73.6 fps, slowest 1% as low as 38.1 fps), which the test correctly failed. The cause is not established. Third consecutive runs have been slower before, so heat is one candidate, along with Brave.

## Still looks wrong

Most serious first.

1. **Upper right bush** is less dense and less bright than the photo, though its shape is now much closer.
2. **High leaves up close** on the branches still look too lime and flat in the close-up view.
3. **Top-left glow** is dimmer than the photo. Going brighter produced a visible disc.
4. **Fish up close.** Both sides are the same, with some repeated skins, and fins are solid.
5. **Plant species.** Land plants stand in for aquatic ones.
6. **Room.** The sofa has few real creases, and the TV picture is still.
