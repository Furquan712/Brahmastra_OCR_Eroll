# Layout templates

One JSON file per layout. `default.json` is the ECI Hindi 3x10 card grid. A state
template only has to list what differs from its parent (`"extends": "default"`).

Selection order: `--template <name>` > first template whose `match.states` contains the
state folder name (case-insensitive) > `default`.

Keys:

| key | meaning |
|---|---|
| `grid.cols` / `grid.rows` | expected card grid; used to validate counts and as a fallback geometry |
| `strips.rowsPerStrip` | how many card rows are sent per model call in `strip` mode (2 keeps text at native resolution) |
| `strips.padPx` | extra pixels above/below each strip crop |
| `fallbackBody` | fractional page box containing the card grid, used only when automatic row detection fails |
| `detection.minLineFraction` | a horizontal rule must be dark across at least this fraction of the page width to count as a full card-row border (text lines reach ~0.3, borders ~0.95; a trailing single-card row is found by position instead) |
| `classify.longEdgePx` | downscale size for the cheap page-classification call |
| `labels` | field label vocabulary shown to the model (so a Marathi/Bengali template can change it) |
| `relationMap` / `genderMap` | closed-vocabulary lookup tables (Hindi label -> English value) |
| `epicPatterns` | regexes an EPIC must match, else the row is flagged |
| `sectionHints` | header phrases that identify main / supplement / deletion / modification blocks |
| `promptNotes` | free text appended to the extraction prompt describing the card layout |
| `local.langs` | Tesseract languages for the card body, primary first (`eng+hin`: English first reads digits far better) |
| `local.headerFraction` | top fraction of the page OCR'd to classify the page and read भाग संख्या |
| `local.epicBox` / `local.serialBox` / `local.bodyBox` | crop boxes as fractions of the card rectangle: EPIC (top-right), serial box interior (top-left), text lines (left of the photo box) |

To add a state whose layout differs (say 2 columns x 8 rows), copy `uttar-pradesh.json`,
set `match.states`, `grid`, `labels`, and `promptNotes`, then check it with:

```
npm run dev -- inspect "raw-data/<State>/<folder>/<file>.pdf" --page 3 --template <name>
```

`inspect` writes the detected strips/cards to `./tmp/inspect/` so you can eyeball the crops.
