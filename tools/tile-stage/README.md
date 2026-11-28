# Tile stage

Makes Work's tile images (README's Thumbnail rule, Stage): every work on one black stage,
under one light, doing its one thing, so the grid reads as one wall, as gougoucore.com's does.

- **Work that is a screen** (`stage.html`): a laptop seen straight on in a dark room, or a
  phone standing upright (Light Life's app), lit only by its own screen. The screen is the real
  app, captured frame by frame (`capture.mjs`), with its cursor where it has one (a hand on
  gougoucore's tiles; drawn by `stage.html` for TypeLab, since a headless screen has none).
- **Work that is printed** (`print.html`): the prints lying on the black table under a light
  from above, seen from above, in a stack; every so often the top one is drawn away toward
  you, out of the light, and the next lies under it.

```sh
python3 tools/tile-stage/make.py typelab           # or clack, light-life, nbcu, editorial, all
python3 tools/tile-stage/make.py nbcu --out ~/Desktop/try   # somewhere else, to compare
```

Each tile gets `stage.jpg` (the still, 1440 × 2000) and `stage.mp4` (the loop: 6 s, 30 fps,
720 × 1000, silent, seamless, opening on the still) in its project's image folder; Editorial
Collection, its wide tile's halves (`pieces/editorial-stage-left.jpg`, `-right.jpg`) and one
loop for both (`pieces/editorial-stage.mp4`, 1440 × 1000). `content/projects.json` points
each tile's `"detail"` at the still and its `"motion"` at the loop.

| Tile | What's on the stage | Its one thing |
|---|---|---|
| TypeLab | typelab.ink on a laptop (Didone, "Galaxy") | the cursor drags Weight from 24 to 100 and back |
| Light Life | the prototype (`assets/prototypes/light-life`) on a phone | Play a day, the lamp's light through 24 hours |
| Clack | Clack's own page (`Ai projects/Keyboard/index.html`) on a laptop | one stroke over Cyanotype, the print sinking back |
| NBCUniversal | four pitch boards, printed 16:9 | the top board drawn away, every 1.5 s |
| Editorial Collection | two posters a column, under the grid's columns | the top poster drawn away, the two sides taking turns |

What goes on the stage, and when the loop starts (its still), is set in `make.py` (TILES),
`capture.mjs` (each app's action), and `print.html` (SETUPS: which prints, in what order).

Needs Google Chrome, the node in `~/Documents/Portfolio/Ai projects/TypeLab/.tools` (or set
`NODE`), TypeLab's `tools/browser/cdp.mjs`, and an ffmpeg with libx264 (set `FFMPEG`, or
`python3 -m pip install --user imageio-ffmpeg`). TypeLab's tile needs the internet (it's
captured from typelab.ink); Light Life's shows the time and weather of the moment it's made.
