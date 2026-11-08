# Water colour and frame-rate review

Compare `front-tank.png` with `reference-photo.png`.

## Changed

- The water haze and the top of the background are bluer and less bright.
- The top-left glow is tighter, so it stays clear of the middle of the tank.

## Colour against the photo (sRGB)

Patches match `reviews/m13/notes.md`.

| Region | Photo | m13 | Now |
| --- | --- | --- | --- |
| Top-left glow | 182, 187, 186 | 157, 167, 152 | 149, 161, 149 |
| Top water | 132, 145, 168 | 172, 180, 184 | 150, 161, 170 |
| Middle water | 110, 124, 117 | 113, 120, 107 | 104, 111, 102 |
| Upper right plants | 154, 170, 81 | 95, 112, 50 | 93, 110, 50 |
| Lower right plants | 78, 83, 45 | 85, 94, 39 | 85, 93, 39 |
| Lower-left plants | 82, 101, 36 | 86, 100, 32 | 86, 100, 32 |
| Sand | 210, 195, 143 | 186, 171, 121 | 186, 171, 121 |

## Tests

33 of 33 unit tests and 17 of 17 browser tests pass. `tests/performance.spec.ts` passed on all three runs, with Screen Studio closed and Brave idle. Averages were 99.8-100 fps at every view; 100 looks like a cap, so the real headroom is unknown. Lowest minimum per view across the runs:

| View | Lowest minimum fps |
| --- | --- |
| Wide room | 71.9 |
| Front | 61.3 |
| Side | 47.8 |
| Underside | 41.0 |
| Close-up | 90.1 |

The underside view's 41.0 is close to the 40 fps floor. The same test failed earlier with both apps busy.

## Still looks wrong

Most serious first.

1. **Upper right bush.** The photo has many small, pale leaves; this has large land-plant leaves with dark patterned faces. Brightness cannot close this gap, so the plants themselves need to change.
2. **High leaves up close** still look too lime and flat in the close-up view.
3. **Top-left glow** is dimmer than the photo. Going brighter produced a visible disc.
4. **Fish up close.** Both sides are the same, with some repeated skins, and fins are solid.
5. **Plant species.** Land plants stand in for aquatic ones.
6. **Room.** The sofa has few real creases, and the TV picture is still.
