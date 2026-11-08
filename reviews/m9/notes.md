# Stutter fix and gnarled wood review

Compare `wide-room.png` with `reference-photo.png`.

## Changed

- The fish simulation now checks only nearby solids: 9.0 ms down to 0.73 ms per step. Lowest frame rates rose from about 10-18 fps to 23-32 fps.
- Real forked branches rise from the logs, darkened to match them. Everything stays inside the glass.
- Leaves are less glowing up close, and water brightness is back near the photo's.

## Still looks wrong

Most serious first.

1. **Frame rate.** 29-40 fps on average against a target of 60, with the owner's Brave tab also running the app.
2. **Top of the water and the right-hand bush** are darker than the photo (top water 165,182,177 against 187,194,197; right plants 69,81,45 against 150,165,76).
3. **Fish up close.** Both sides are the same, with some repeated skins, and fins are solid.
4. **Plant species.** Land plants stand in for aquatic ones.
5. **Room.** A bright streak crosses the TV, the sofa has few real creases, and the TV picture is still.
