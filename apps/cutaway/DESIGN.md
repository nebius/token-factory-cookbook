# Cutaway design: toy box

Cutaway should feel like a box of bright, well-made toys: friendly enough for a ten-year-old, clear enough for an engineer. White cards with thick dark outlines sit on a soft lilac page, a few bright colour blocks say what's what, and the 3D model always sits on light sky paper so every part, dark or light, is easy to see. The tokens live in `app/globals.css`.

## Colour

| Token | Light | Use |
| --- | --- | --- |
| `--bg` | `#ede7ff` | Lilac page |
| `--panel` | `#ffffff` | Cards, bars, inputs |
| `--ink` / `--rule` | `#16121f` | Text and the 2.5px outline around every card and button |
| `--ink-3` | `#5e5873` | Secondary text (passes 4.5:1 on white and lilac) |
| `--accent` | `#5b3fd6` | Purple: the one main action per screen. White text. |
| `--pick` | `#ffd23f` | Sunny yellow: the picked part, the active tab or tool, "this one". Dark text. |
| Stage | `#dde9ff` | Sky paper with a soft dot grid: the 3D view and machine pictures, in both themes |
| Blocks | `#ff6fa8` pink, `#7be0b8` mint, `#9fc2ff` sky | Example chips, step numbers, progress |

The picked part glows pink (`#ff3d8b`) in 3D, and its name tag turns yellow.

## Type

- **Bricolage Grotesque** 800 for headings, tight tracking, sentence case.
- **Nunito Sans** for everything else: rounded and very readable. Labels and buttons are 700 to 800.

## Shape

- Rounded: 16px cards, 12 to 14px buttons, pills for chips and tags.
- Every card and button has a 2.5px dark outline. Things that sit on the page get a hard offset shadow (`4px 4px 0`). No blur, no gradients.
- Pages are made of floating cards with gaps between them, not ruled columns.

## Numbers

Every part has a number (its position in Kimi's list). The same number appears in the parts list, on the 3D name tag and on the part page, so a learner can match words to the picture.

## Tone

Short, plain sentences. One main action per screen, in purple. Expert detail is opt-in.
