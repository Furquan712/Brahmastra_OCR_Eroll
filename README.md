# eroll-ocr

Batch OCR pipeline that turns scanned ECI electoral-roll ("eRoll") PDFs into the CSV format the
dashboard already uploads. Every page of these PDFs is a flattened raster image, so every field
has to be OCR'd.

Three engines:

| engine | how | accuracy (Dadri sample, see *Accuracy*) | cost |
|---|---|---|---|
| `local` (default) | **Tesseract on your CPU + algorithms, nothing else.** Multi-pass reads with voting, dedicated EPIC / digit passes, fuzzy label matching, name consensus across the page and PDF, local transliteration. Uncertain cards are *flagged*, not re-read. | EPIC, age, gender, relation 100 %; names 97 %; 90 % of cards fully correct; every wrong card flagged | **$0, no API key, no network** |
| `hybrid` | `local`, plus a vision model re-reads the cards Tesseract is unsure about | slightly better on garbled names | a few cents per PDF |
| `llm` | the vision model reads every page in strips | best on very poor scans | highest |

In every engine **Hindi -> English names are produced locally** by the transliteration engine
described below, and the cover page is parsed from Tesseract text.

Runs as a long-running CLI on a single Linux box (tested budget: 2 vCPU / 4 GB RAM / 80 GB disk).

## How it works

```
raw-data/<State>/<AC No>-<AC Name>-<Year>-<Draft|Final>/*.pdf
        │
        ▼  per PDF (max 2 at once), one page at a time
  pdftoppm (300 dpi PNG)
        │
        ├─ page 1 ──► tesseract (full page) ──► regex: state, AC no/name, part no, year, Draft/Final,
        │             dates, polling station, elector counts; file name cross-checks / fills gaps
        │             OPENROUTER=true: the same TEXT also goes to the model, its AC/part reads win
        │
        ├─ other pages: tesseract reads the header strip ──► voter_grid / supplement / modification /
        │                                                    deletion (skipped) / summary / other
        │                                                    (unreadable header: local engine assumes a
        │                                                     main-roll grid and warns; hybrid asks the model)
        ▼
  detect card rows & columns from the printed borders ──► per card, batched tesseract passes:
        │   EPIC box: eng, whitelist, 1x + 2x + 3x-binarised ──► majority vote
        │   serial box: digits ──► cross-checked with grid order
        │   body: eng+hin (labels, digits) + Hindi-only 2x (names) ──► per-field vote, Latin garbage dropped
        │   age line: re-read at 3x with a digit whitelist when unsure; gender/relation matched fuzzily
        ▼
  page consensus, then PDF consensus: a name read confidently elsewhere (or in the name lexicon)
  repairs a one-character OCR defect (dropped halant, ब/व, े/ै ...) ──► name_hi_corrected
        │
        │   local engine: still-uncertain cards get flags (epic_low_conf, name_garbled, ...)
        │   hybrid engine: those cards go to the vision model instead
        ▼  every card
  local transliteration (rules + trained model + overrides.tsv) ──► Name_eg / Relation_name_eg
        │
        ▼  all PDFs in the folder
  merge + EPIC dedupe (later row wins) ──► validate/flag ──► ONE CSV + summary + log
```

## Cross-PDF Hindi name memory

Every finished PDF teaches the next one. Devanagari name tokens read with field confidence
>= 0.90 (and not themselves a consensus repair) are recorded per PDF hash in
`data/learned/hi-names.json`; once a token has been read confidently in **2 different PDFs** it
joins the lexicon as a trusted token for name consensus, so later PDFs repair one-character OCR
defects towards it. Re-running a PDF adds nothing, and a PDF never "confirms" itself, so it
improves *new* PDFs, not the ones it was learned from. It changes Hindi reads only; English
spellings still come from the transliteration engine. Delete the file to forget, or pass
`--no-learn` / `OCR_NAME_MEMORY=false` for a run that neither reads nor updates it.

## Hindi -> English names (no model API)

`data/translit/` holds a self-contained transliteration engine:

1. **Rules** (`src/translit/rules.ts`): Devanagari is split into syllables; schwa deletion as
   spoken (सुरेश -> Suresh, कमला -> Kamla, रामचंद्र -> Ramchandra), nasal and conjunct rules, and
   the Roman spellings used on Indian IDs (sh, chh, kh, no diacritics). This alone scores ~87 %
   exact on the eval set.
2. **Model** (`model.json`, built by `translit-train`): for every syllable the rules list the
   spellings it *may* take (ी -> i/ee, व -> v/w, inherent a kept/dropped ...). Training aligns
   each `<Devanagari> <Roman>` pair in `seed-names.tsv` (and any corpus you add) to those
   alternatives and counts which one was used in which context (neighbouring syllables, position).
   At run time the alternatives are re-ranked from those counts, backing off to the rule when
   there is no evidence. Attested tokens are also kept as an exact-match lexicon.
3. **`overrides.tsv`**: exact token or phrase -> spelling, applied first. Edit it any time; no
   retraining needed.

```bash
npm run translit -- "धीर सिंह" "मुनेन्दर"       # try names   (--no-lexicon / --rules-only to compare)
npm run translit:eval                           # score against data/translit/eval.tsv
npm run translit:train                          # rebuild model.json from data/translit/*.tsv
npm run translit:train -- --extra hi.lexicon.tsv aksharantar_hi.json   # add big corpora (Dakshina, Aksharantar)
```

To improve spellings: add rows to `seed-names.tsv` (or a new `*.tsv` in that folder), retrain,
re-run `translit:eval`. The eval set is deliberately *not* used for training. Scores shipped:
rules only 87 %, model without lexicon 92 %, full engine 100 % on `eval.tsv`.

Serial numbers are taken from grid position (cards are printed consecutively), cross-checked
against the serial-box read; disagreements are flagged `serial_corrected`.

## Install

You need four things: **Node.js 20+**, **Tesseract 5** with the `eng` and `hin` languages,
**Poppler** (`pdfinfo` / `pdftoppm`), and this project built with `npm`. The default `local`
engine needs nothing else: no API key, no network.

### Linux (Ubuntu / Debian server)

```bash
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-hin tesseract-ocr-eng
# Recommended: the "best" Hindi model is noticeably more accurate than the packaged one
sudo curl -L -o /usr/share/tesseract-ocr/5/tessdata/hin.traineddata \
  https://github.com/tesseract-ocr/tessdata_best/raw/main/hin.traineddata
# Node 20+
npm ci
npm run build
cp .env.example .env                           # defaults to the local engine; nothing else needed
```

### macOS

```bash
brew install node tesseract poppler
curl -L -o "$(brew --prefix)/share/tessdata/hin.traineddata" \
  https://github.com/tesseract-ocr/tessdata_best/raw/main/hin.traineddata
npm ci && npm run build && cp .env.example .env
```

`tesseract --list-langs` must show `eng` and `hin` on every platform.

### Windows 10 / 11

Use **PowerShell** (Start menu -> "PowerShell"). Commands below are PowerShell; open a **new**
PowerShell window after each install step so the updated `PATH` is picked up.

**1. Node.js 20+**

```powershell
winget install OpenJS.NodeJS.LTS
node -v          # must print v20 or later
```

(Or download the LTS installer from <https://nodejs.org>.)

**2. Tesseract OCR with Hindi**

```powershell
winget install UB-Mannheim.TesseractOCR
```

(Or run the installer from <https://github.com/UB-Mannheim/tesseract/wiki>. In the installer,
under *Additional language data*, tick **Hindi**.)

Download the more accurate "best" Hindi model over the installed one (run PowerShell **as
Administrator** for this, because it writes into `Program Files`):

```powershell
Invoke-WebRequest -Uri "https://github.com/tesseract-ocr/tessdata_best/raw/main/hin.traineddata" `
  -OutFile "C:\Program Files\Tesseract-OCR\tessdata\hin.traineddata"
```

The installer does not add Tesseract to `PATH`. Either add `C:\Program Files\Tesseract-OCR`
to `PATH` (Settings -> System -> About -> Advanced system settings -> Environment Variables ->
*Path* -> Edit -> New), or tell the pipeline where it is in `.env` (step 5):

```
TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
```

Check:

```powershell
& "C:\Program Files\Tesseract-OCR\tesseract.exe" --list-langs     # must list eng and hin
```

**3. Poppler (`pdfinfo`, `pdftoppm`)**

Download the latest `Release-xx.xx.x-0.zip` from
<https://github.com/oschwartz10612/poppler-windows/releases>, extract it to e.g. `C:\poppler`,
and add **`C:\poppler\Library\bin`** to `PATH` (same dialog as above). There is no `.env`
setting for Poppler; it must be on `PATH`. (Alternatives: `choco install poppler` or
`scoop install poppler`, which set `PATH` for you.)

Check, in a new PowerShell window:

```powershell
pdftoppm -v
pdfinfo -v
```

**4. The project**

Copy the `Brahmastra_OCR` folder to the PC (avoid OneDrive-synced folders: the cache and page
images churn a lot of small files). Then, inside that folder:

```powershell
cd C:\path\to\Brahmastra_OCR
npm ci
npm run build
```

If `npm` is blocked with *"running scripts is disabled on this system"*, run once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

**5. Configuration**

```powershell
Copy-Item .env.example .env
notepad .env
```

For the default free `local` engine the only line you may need is `TESSERACT_CMD=...` from step 2.
`.env` is read from the **current folder**, so always run the commands from the project folder.

**6. Smoke test** (first 2 pages of one folder, ~30 s):

```powershell
node dist\cli.js run "raw-data\Uttar Pradesh\62-Dadri-2026-Final" --limit-pages 2 --force
```

It should log `engine local (tesseract + algorithms, no model, no API)` and write CSVs under
`output\`. A `pdftoppm not found` / `tesseract failed` error means step 2 or 3 is not on `PATH`.

Notes for Windows:
- `bin/run` is a bash script; on Windows use `node dist\cli.js run ...` directly (same options).
- Speed: pages run in parallel up to the number of CPU cores (`--page-concurrency`). On a laptop
  that is also used for other work, `--page-concurrency 4` keeps it responsive.
- Windows Defender real-time scanning of `cache\` and `tmp\` can slow runs noticeably; excluding
  the project folder helps.

## Input folder format (`raw-data`)

Put the PDFs in **one folder per constituency (AC) and roll type**, inside a folder named after
the **state**:

```
raw-data/
└── <State>/
    └── <AC No>-<AC Name>-<Year>-<Draft|Final>/
        ├── <part PDF>.pdf
        ├── <part PDF>.pdf
        └── ...
```

Example:

```
raw-data/
└── Uttar Pradesh/
    ├── 62-Dadri-2026-Final/
    │   ├── 2026-EROLLGEN-S24-62-SIR-FinalRoll-Revision1-HIN-793-WI.pdf
    │   └── 2026-EROLLGEN-S24-62-SIR-FinalRoll-Revision1-HIN-794-WI.pdf
    └── 390-Varanasi Cantt-2024-Draft/
        └── ...
```

Rules:

| part | rule | example |
|---|---|---|
| state folder | the state's name; it selects the layout template (`templates/*.json` -> `match.states`, e.g. `Uttar Pradesh`, `UP`). No match -> the `default` template | `Uttar Pradesh` |
| AC folder | exactly `<AC No>-<AC Name>-<Year>-<Draft\|Final>`: number, a hyphen, the name (spaces allowed), a 4-digit year, then `Draft` or `Final` (case-insensitive) | `390-Varanasi Cantt-2024-Final` |
| PDFs | any `*.pdf` directly in the AC folder (sub-folders are not scanned), one PDF per part, processed in natural order (part 2 before part 10) | |
| PDF names | free, but the original ECI download names (`<Year>-EROLLGEN-<State code>-<AC No>-...-<Part No>-WI.pdf`) are cross-checked against the cover page and fill gaps if the cover is unreadable | `2026-EROLLGEN-S24-62-...-794-WI.pdf` |

- The state, AC number/name, year and Draft/Final in the output file names come from the folder
  names. The **part number** is read from each PDF's cover page.
- If the AC folder name does not match the pattern, the run still works; it warns and names the
  output after the folder (`<State>-<folder name>...csv`).
- Avoid characters Windows forbids in names (`\ / : * ? " < > |`).
- Only the original scanned ECI PDFs are supported (every page is an image). Use one folder per
  roll: a Draft and a Final of the same AC go in two folders.

Several constituencies: run the command once per AC folder, for example:

```bash
for d in "raw-data/Uttar Pradesh"/*/; do node dist/cli.js run "$d"; done                       # Linux / macOS
```
```powershell
Get-ChildItem "raw-data\Uttar Pradesh" -Directory | ForEach-Object { node dist\cli.js run $_.FullName }   # Windows
```

Finished PDFs are cached (`cache/`), so re-running a folder after an interruption only OCRs what
is missing.

## Choose cloud or local with one switch (hybrid / llm engines only)

The default `local` engine ignores all of this: no provider, no key, no network. For `hybrid`
or `llm`, in `.env`:

```
OPENROUTER=true            # cheap cloud model via OpenRouter: fast, a few dollars per 400 PDFs
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=qwen/qwen3.7-flash

OPENROUTER=false           # local model via Ollama on this machine: free, but one GPU = slow
OLLAMA_MODEL=qwen3-vl:8b-instruct
```

| mode | parallelism set automatically | cover page | names |
|---|---|---|---|
| `OPENROUTER=true` | up to 4 PDFs at once, 8 model calls at once | Tesseract text, plus one text-only model call for AC/part | local |
| `OPENROUTER=false` | 2 PDFs at once (Tesseract of one overlaps the model calls of the other), 1 model call at a time | Tesseract text only, no model call | local |

Any of `OCR_PDF_CONCURRENCY`, `OCR_CONCURRENCY`, `OCR_ESCALATION_BATCH`, `OCR_REQUEST_TIMEOUT_MS`
set explicitly still overrides the switch. Leave `OPENROUTER` unset to configure the provider by hand
(see *Providers* below).

Local mode needs the model in Ollama first (`ollama pull qwen3-vl:8b-instruct`); on a slow line the
resumable download described in the project notes is more reliable. The first request after Ollama
starts loads the 6 GB model, which takes several minutes from an external drive.

## Run

```bash
bin/run "raw-data/Uttar Pradesh/390-Varanasi Cantt-2024-Final"
# equivalent:
node dist/cli.js run "raw-data/Uttar Pradesh/390-Varanasi Cantt-2024-Final" --out ./output
```

Windows (PowerShell, from the project folder):

```powershell
node dist\cli.js run "raw-data\Uttar Pradesh\390-Varanasi Cantt-2024-Final" --out .\output
```

Typical speed with the local engine: about 0.4 pages/s on a 10-core machine (a 42-page part in
~2.5 min), roughly 0.1 pages/s per core. The summary file reports the run time and pages/s.

Output, in `--out` (default `./output/`), one CSV per part PDF:

```
output/<State>/<AC No>-<AC Name>-<Year>/<State>-<AC No>-<AC Name>-<Year>-<Draft|Final><part no>.csv
e.g. output/Uttar Pradesh/390-Varanasi Cantt-2024/Uttar Pradesh-390-Varanasi Cantt-2024-Final794.csv
```

| file (in the AC folder) | contents |
|---|---|
| `...-Final<part no>.csv` | one row per elector of that part (main roll + supplements) |
| `<State>-<AC No>-<AC Name>-<Year>-<Draft\|Final>.summary.txt` / `.json` | counts, flags by reason, failures, warnings, per-PDF table |
| `logs/` | full run logs (progress, pages/sec, retries, dedupe decisions) |

The part number is read from the PDF. If two PDFs report the same part number, the second CSV gets
the PDF file name appended instead of overwriting the first. Duplicate EPICs are resolved within a
part (later row wins), not across parts.

State / AC / year / type for the filename come from the folder name and are cross-checked against
the cover page of every PDF; disagreements are logged as warnings, never fatal.

Useful options (all also settable in `.env`, see `.env.example`):

```
--engine local|hybrid|llm         --local-min-conf 0.85   --provider claude|openai|gemini
--model <id>                      --dpi 300               --concurrency 2   --ocr-concurrency 4
--threshold 0.7                   --template <name>       --limit-pages N   (smoke test)
--force   (ignore cache)          --bom   (Excel-friendly CSV)   --dry-run
--page-concurrency N  (pages in parallel, default CPU cores)      --no-learn  (skip name memory)
```

Other commands:

```bash
node dist/cli.js templates                       # list layout templates
node dist/cli.js inspect <file.pdf> --page 3     # check grid detection; writes crops to ./tmp/inspect
node dist/cli.js ocr-eval                        # score the local read against test/fixtures/*.json
```

## CSV columns

The first 14 columns match the existing upload format exactly:

```
PS_name_eg, PS_name_hi, Part_no, Epic_no, Name_eg, Name_hi, Relation_type_eg, Relation_type_hi,
Relation_name_eg, Relation_name_hi, house_no, age, Gender_eg, Gender_hi
```

`Gender_eg`/`Gender_hi` and `Relation_type_*` hold the mapped raw values (`Male` / `पुरुष`,
`Father` / `पिता`); no further normalisation is done. Then audit-only columns the dashboard ignores:

```
_source_pdf, _page, _serial, _section (main|supplement|modification), _ocr_confidence,
_ocr_engine (tesseract | llm | llm(<why it was escalated>)), _flag_reason
```

`_flag_reason` is a `;`-separated list. Flagged rows are always written, never dropped:

| flag | meaning |
|---|---|
| `epic_missing` / `epic_invalid` | no EPIC, or it does not match the template's EPIC patterns |
| `epic_autocorrected` | O/I/S/B/Z in the numeric tail were replaced by digits |
| `name_missing` / `name_en_missing` / `name_hi_missing` | empty name field(s) |
| `age_missing` / `age_out_of_range` / `age_under_18` | age not an integer in 0..120 (under 18 is only a hint) |
| `relation_unknown` / `gender_unknown` | label not in the closed vocabulary |
| `low_confidence` | confidence below `--threshold` |
| `serial_missing` / `serial_gap` / `serial_corrected` | serial not consecutive within a section / serial-box read disagreed with grid position |
| `name_hi_corrected` / `relation_name_hi_corrected` | consensus replaced a one-character OCR defect with a spelling read elsewhere / in the lexicon (original in the log) |
| `epic_low_conf` / `epic_unreadable` / `name_low_conf` / `name_garbled` / `name_unreadable` / `relation_*` / `age_unreadable` / `gender_unreadable` / `age_gender_low_conf` | local engine: the read is below `OCR_LOCAL_MIN_CONF` or failed; check the row (hybrid sends these cards to the model instead) |
| `llm_fallback_empty` | hybrid: model saw no card in an escalated crop; local read kept |
| `deleted_stamp` | card was overprinted DELETED on a non-deletion page |
| `part_no_missing` / `part_no_mismatch` | page header part number absent / differs from the cover page |
| `dup_epic_replaced_earlier` | this row replaced an earlier row with the same EPIC |

## Accuracy (local engine)

Measured with `node dist/cli.js ocr-eval` against a hand-checked page
(`test/fixtures/dadri-794-p3.json`: 30 cards, Dadri UP, 300 dpi, packaged `hin` model):

| field | correct |
|---|---|
| EPIC, age, gender, relation type | 30/30 |
| name (Devanagari) | 29/30 |
| relation name | 29/30 |
| house no | 29/30 (`.2` read as `2`) |
| **cards fully correct** | **27/30** - the 3 others all carry a review flag |

For comparison the same page with plain single-pass Tesseract was 20/30 (names 24/30), the
difference being the Hindi-only pass, the votes and the consensus repair. Remaining failure
modes: a card with two defects in one name (left flagged `name_low_conf`), and the roll's own
inconsistent spellings (`खुरशैद` next to `खुरशेद`) being normalised - those are flagged
`name_hi_corrected` with the original read kept in the log.

To measure a change, or a new state's print: render a page, write its truth JSON next to the
sample one, and run `ocr-eval`. Older or noisier scans will flag more rows; that is by design -
flagged rows are always written, never dropped.

Cover page: AC number/name, part number, dates and elector counts parse deterministically
from the Tesseract text (cross-checked against the file name). The vision model, by contrast,
had returned the parliamentary seat as the AC on one sample.
- About 30-40 % of cards are escalated at the default threshold on this print. Older or noisier
  scans will escalate more; that is by design.

No engine, including the model, is 100 % correct. The audit columns exist so a human can review
flagged rows before upload.

## Throughput and cost

- Local engine: ~10 s per 30-card page on one core (six batched Tesseract passes). Pages run in
  parallel up to `--page-concurrency` (default: CPU cores), across all PDFs. Measured on a
  10-core Apple M-series Mac: 58 pages (2 PDFs, 1,479 cards) in 142 s, ~0.41 pages/s, i.e.
  ~74 pages in 3 minutes. On a 2 vCPU server expect ~0.1 pages/s. Cost: none.
- Hybrid engine adds one or two batched model calls per page for escalated cards; nothing for
  names or (unless `OCR_COVER_LLM=true`) the cover page. With a cheap OpenRouter model that is
  about 1-2 cents per PDF; with Claude Opus 5.5 a few cents per page.

## Dedupe rule

Rows are read in order: PDFs sorted naturally by filename, pages ascending, cards in reading
order. If an EPIC has already been seen, the later row replaces the earlier one in place (same
rule as the XLSX upload path). Rows with no EPIC are never deduped.

## Reliability

- **Resumable.** Each PDF's result is cached at `cache/<sha256>.json`; pages are cached
  individually while a PDF is in progress. Re-running `run` skips finished PDFs and finished pages.
  `--force` re-OCRs.
- **Isolation.** A corrupt or unreadable PDF is logged and reported in the summary; the rest of
  the folder still runs. Exit code is 1 if any PDF failed, else 0.
- **Memory.** Pages are rendered one at a time to `./tmp/<hash>/`, cropped with `sharp`, and the
  PNG is deleted before the next page. Tesseract runs single-threaded per process
  (`OMP_THREAD_LIMIT=1`) so two PDFs fit on two vCPUs.
- **Retries.** Rate limits / 5xx / network errors / malformed JSON are retried with backoff
  (`OCR_MAX_RETRIES`, default 4). Refusals and auth errors are not retried.

## Providers

| `OCR_PROVIDER` | key | default model |
|---|---|---|
| `claude` | `ANTHROPIC_API_KEY` | `claude-opus-5-5` |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-pro` |

`--provider mock` needs no key and returns synthetic cards; use it only to check the plumbing
(rendering, Tesseract, caching, CSV shape) on a new box. All three real providers receive the
same prompts and the same JSON schema (structured output is enforced where the provider supports
it, and the reply is validated with zod either way).

## Templates

Grid geometry, Tesseract crop boxes, and vocabulary are per-state templates in `templates/`; see
[templates/README.md](templates/README.md) for adding a state whose layout differs.

## Development

```bash
npm run dev -- run "raw-data/Uttar Pradesh/62-Dadri-2026-Final" --limit-pages 4 --provider mock
# raw-data/Uttar Pradesh/62-Dadri-2026-Final/ holds symlinks to the two sample PDFs in example/
npm test            # unit tests (folder parsing, CSV, normalisation, dedupe, tesseract parsing, votes, consensus, cover parsing, transliteration)
npm run typecheck
```
