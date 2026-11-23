# Analysis scripts behind the paper

Everything in `../data/gbn_stats.json` (the only input of `../make_figs.py` and `../build_paper.cjs`)
is produced by the scripts here. The `.cjs` scripts read the dashboard's MongoDB (connection taken
from the dashboard's `.env`) and need its `node_modules` on `NODE_PATH`; the Python scripts need
only Poppler, Tesseract, numpy and Pillow. None of them writes row-level personal data into the repo.

| Script | What it does |
|---|---|
| `gbn_stats.cjs` … `gbn_stats4.cjs` | Booth-level aggregates of the three Gautam Buddh Nagar rolls (parts, gender, ages, households, sections, actions, EPIC formats, duplicates) → `../data/gbn_stats.json` |
| `under18.cjs` | Rows printed with an age below 18 or above 120, by value (`under18.json`) |
| `dups_jewar.cjs`, `dups_pages.cjs` | Duplicate-EPIC groups in Jewar and their position on the page, for visual checking |
| `blank_pick.cjs` | Random sample of rows whose gender could not be read, for visual checking |
| `render_dups.py` | Cuts the sampled cards out of the roll PDFs (run where the PDFs are) |
| `deleted_stats.cjs` | Action status, blank-gender and duplicate overlap for all three constituencies (`deleted_stats.json`) |
| `stamp_scan.py` | Scans whole roll PDFs for cards overprinted with the diagonal DELETED stamp (grey-ink detector + serial-box OCR) |
| `fill_part_names.cjs` | Fills missing polling-station names in the dashboard from the ECI part lists in `../../data/parts/` |
| `bench/run_bench.sh`, `bench/results.csv` | Throughput against pages in flight (Table 4b / Figure 13) |
