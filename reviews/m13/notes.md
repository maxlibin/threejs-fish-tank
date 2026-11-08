# Plant light and top-left glow review

Compare `front-tank.png` with `reference-photo.png`.

## Changed

- Plant brightness now depends on height under the LED bar: low plants are shaded, and high leaves are slightly paler.
- A softer, whiter glow sits high on the left behind the bubbles, and the background water is slightly bluer.
- The TV picture and floor reflection were recaptured to match.

## Colour against the photo (sRGB)

All three columns use the same sample patches this round. They differ from the patches in `reviews/m12/notes.md`, so compare only within this table.

| Region | Photo | Before (m12) | Now |
| --- | --- | --- | --- |
| Top-left glow | 182, 187, 186 | 136, 153, 130 | 157, 167, 152 |
| Top water | 132, 145, 168 | 167, 184, 179 | 172, 180, 184 |
| Middle water | 110, 124, 117 | 113, 124, 107 | 113, 120, 107 |
| Upper right plants | 154, 170, 81 | 98, 116, 43 | 95, 112, 50 |
| Lower right plants | 78, 83, 45 | 109, 121, 42 | 85, 94, 39 |
| Lower-left plants | 82, 101, 36 | 118, 138, 33 | 86, 100, 32 |
| Sand | 210, 195, 143 | 187, 172, 121 | 186, 171, 121 |

## Tests

33 of 33 unit tests and 16 of 17 browser tests pass. `tests/performance.spec.ts` fails, measured with the owner's Brave and Screen Studio apps open:

| View | Average fps | Minimum fps |
| --- | --- | --- |
| Wide room | 55.0 | 35.5 |
| Front | 54.4 | 36.8 |
| Side | 52.2 | 33.9 |
| Underside | 65.7 | 42.9 |
| Close-up | 79.1 | 47.6 |

## Still looks wrong

Most serious first.

1. **Upper right bush** is still darker on average than the photo. Its highlights already match, so the gap is in the midtones; more top light only clipped the leaves to flat lime.
2. **High leaves up close** still look too lime and flat in the close-up view.
3. **Top-left glow** is still dimmer than the photo. Going brighter produced a visible disc.
4. **Top water** is brighter and less blue than the photo.
5. **Fish up close.** Both sides are the same, with some repeated skins, and fins are solid.
6. **Plant species.** Land plants stand in for aquatic ones.
7. **Room.** The sofa has few real creases, and the TV picture is still.
