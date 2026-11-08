# Draw cost review

Compare `wide-room.png` with `reference-photo.png`.

## Changed

- Triangles per frame: 16-20 million down to 2.8-5.4 million, checked by `tests/drawCost.spec.ts`, which other programs cannot affect.
- The faint reflection in the water's surface now draws only the background, reflections are simpler when looking through two panes, and panes off-screen are skipped.
- The bush and the top of the water are brighter, and the TV has no bright streak.

## Colour against the photo (sRGB)

| Region | Photo | Render |
| --- | --- | --- |
| Top water | 187, 194, 197 | 181, 198, 194 |
| Middle water | 117, 129, 121 | 125, 138, 122 |
| Lower-left plants | 78, 103, 32 | 106, 127, 34 |
| Right plants | 150, 165, 76 | 76, 89, 47 |
| Sand | 198, 185, 135 | 185, 164, 123 |

## Still looks wrong

Most serious first.

1. **Right-hand bush.** Still darker than the photo, while the left plants are now a little too bright. They need separate adjustment.
2. **Fish up close.** Both sides are the same, with some repeated skins, and fins are solid.
3. **Plant species.** Land plants stand in for aquatic ones.
4. **Top of the water.** The surface looks plain from below, with no reflections.
5. **Room.** The sofa has few real creases, and the TV picture is still.
