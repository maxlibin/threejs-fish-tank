# Real scans review

Compare `wide-room.png` with `reference-photo.png`.

## Changed

- Trunks, rocks, most plants, and moss are real scans from Poly Haven, in place of generated ones.
- Colours are measured from the owner's photo and matched by number, not chosen by eye.
- Light falls off from the top of the tank to the bottom, and ambient light is much lower, so plants shade each other.
- Fins no longer show stochastic grain; they are drawn solid and tinted toward the water behind them.

## Colour against the photo (sRGB)

| Region | Photo | Render |
| --- | --- | --- |
| Top water | 187, 194, 197 | 182, 204, 196 |
| Middle water | 117, 129, 121 | 131, 146, 134 |
| Lower-left plants | 78, 103, 32 | 89, 109, 33 |
| Right plants | 150, 165, 76 | 74, 87, 58 |
| Sand | 198, 185, 135 | 179, 159, 118 |
| Right wall | 50, 51, 47 | 44, 47, 39 |
| Cabinet | 94, 82, 68 | 102, 88, 69 |

Regions are chosen by hand in each image, so these are close comparisons, not exact ones.

## Still looks wrong

Most serious first.

1. **Right-hand plants** are much darker than the photo's bright, lit bush.
2. **Fish.** Against real scanned plants, the fish look the most computer-generated. They were built by hand, with no scan or artist model behind them.
3. **Wood.** Real now, but thickened from thin scans, so it has less character than the photo's gnarled branch and is thin at the top of its sweep.
4. **Bubbles and glow** at the top left are weaker than the photo's bright fizz.
5. **Land plants.** These are scans of houseplants and ferns standing in for aquatic plants. They look real, but an aquarist would notice.
6. **Gravel** in the front is still more visible than in the photo, where plants cover it.

## Frame rate

About 25 fps in the last full run, against a target of 60, with the owner's Brave tab also running the app. Needs re-measuring with only one copy running.
