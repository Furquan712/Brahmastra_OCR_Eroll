"""Builds paper/analysis.ipynb: every figure and table of the paper as a runnable notebook cell,
with the code that produced it and its output. Reads data/gbn_stats.json (and the stamp-scan
outputs when present). Run from paper/:  python3 make_notebook.py && jupyter nbconvert --execute ...
or let the script execute it (needs nbclient and ipykernel in the same environment)."""
import json, re, sys, os
import nbformat as nbf
from nbformat.v4 import new_notebook, new_markdown_cell, new_code_cell

HERE = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(HERE, "make_figs.py"), encoding="utf-8").read()

# split make_figs.py into its figure blocks: header (imports + helpers) and one block per "# ---------- Fig"
parts = re.split(r"\n(?=# ---------- )", src)
header, blocks = parts[0], parts[1:]
header = header.replace('OUT = "figures/"', 'OUT = "figures/"\nimport os; os.makedirs(OUT, exist_ok=True)')
header = header.replace('matplotlib.use("Agg")\n', '%matplotlib inline\n')
# in the notebook the figures should also show inline: replace plt.close() in save() with plt.show()
header = header.replace("plt.close()", "plt.show()")

nb = new_notebook()
cells = nb["cells"]
cells.append(new_markdown_cell("""# Making the Invisible Roll Visible — analysis notebook

Every number, table and figure in the paper comes from `data/gbn_stats.json`, which holds **booth-level
aggregates** of the three Gautam Buddh Nagar rolls (61 Noida, 62 Dadri, 63 Jewar) pulled from the
dashboard database by the scripts in `analysis/` (`gbn_stats*.cjs`, `under18.cjs`, `deleted_stats.cjs`).
No row-level personal data is read here.

Sections:
1. Load the aggregates and print the headline numbers
2. The figures, cell by cell (same code as `make_figs.py`)
3. Under-18 check
4. Duplicate EPICs, the DELETED stamp and post-draft deletions
5. CPU scaling benchmark (Table 4b)
6. Rebuild the paper
"""))

cells.append(new_markdown_cell("## 1. Load the aggregates"))
cells.append(new_code_cell(header.strip()))
cells.append(new_code_cell('''import pandas as pd
D = ST["district"]; P = ST["press"]
print("District rows", f"{D['rows']:,}", "parts", D["parts"], "sex ratio", D["sexRatio"], "added", f"{D['added']:,}", "modified", f"{D['modified']:,}")
rows = []
for ac in ORDER:
    a = ACS[ac]
    rows.append({"AC": label(ac), "rows": a["rows"], "parts": a["parts"], "pages": a["pages"], "sex ratio": a["sexRatio"],
                 "added": a["action"].get("added", 0), "modified": a["action"].get("modified", 0),
                 "median age": a["medianAge"]["all"], "18-19": a["age18_19"], "80+": a["age80plus"],
                 "dup EPICs": a["dupEpics"], "legacy EPIC rows": a["epicPat"].get("slash", 0)})
pd.DataFrame(rows).set_index("AC")'''))

cells.append(new_markdown_cell("## 2. Figures\n\nEach cell is one figure of the paper; the PNG is also written to `figures/`."))
for b in blocks:
    title = b.splitlines()[0].strip("# -").strip()
    cells.append(new_markdown_cell(f"### {title}"))
    cells.append(new_code_cell(b.strip()))

cells.append(new_markdown_cell("""## 3. Under-18 check

`analysis/under18.cjs` counts, for every constituency, the rows printed with an age below 18 or above 120
and breaks them down by value. The result is in `data/gbn_stats.json` under `ageLt18`."""))
cells.append(new_code_cell('''rows = []
for ac in ORDER:
    u = ACS[ac]["ageLt18"]
    rows.append({"AC": label(ac), "rows": ACS[ac]["rows"], "age < 18": u["total"], "% of rows": round(100 * u["total"] / ACS[ac]["rows"], 2),
                 "age 0 (not read)": u["zero"], "age 1-9": u["a1_9"], "age 10-17": u["a10_17"], "age 17": u["a17"], "age > 120": u["gt120"]})
df = pd.DataFrame(rows).set_index("AC"); df.loc["District"] = df.sum(numeric_only=True); df'''))
cells.append(new_code_cell('''fig, ax = plt.subplots(figsize=(6, 2.8))
for ac in ORDER:
    h = ACS[ac]["ageLt18"]["hist"]; xs = sorted(int(k) for k in h)
    ax.bar([x + (ORDER.index(ac) - 1) * 0.28 for x in xs], [h[str(x)] for x in xs], 0.28, color=AC_COL[ac], label=label(ac))
ax.set_yscale("log"); ax.set_xlabel("Printed age below 18"); ax.set_ylabel("Rows (log)"); ax.legend(fontsize=7)
ax.set_title("Almost all are age 0 (unreadable) or a single digit; ages 10–17 are a few dozen rows", fontsize=8, color=INK); plt.show()'''))

cells.append(new_markdown_cell("""## 4. Duplicate EPICs, the DELETED stamp and post-draft deletions

The dashboard holds no row with status `deleted` for any of the three constituencies, yet the roll prints
the cards of electors removed after the draft with a diagonal **DELETED** watermark and a reason letter
(S shifted, E expired, R duplicate) in the serial box. The OCR pipeline missed the stamp (the overprint
garbled the name and blanked the gender instead), so every such card was written as an existing elector,
and the "duplicate EPIC" groups were, almost without exception, one stamped old card plus one fresh
addition of the same person in another part.

`analysis/deleted_stats.cjs` measured the overlap; `analysis/stamp_scan.py` then scanned every card page
of the three rolls with a pixel-level stamp detector (grey ink sheared along the 30° direction of the
stamp), calibrated on 35 hand-checked cards."""))
cells.append(new_code_cell('''ds = json.load(open("analysis/deleted_stats.json"))
rows = []
for ac in ORDER:
    d = ds[ac]; g = d["dup"]
    rows.append({"AC": label(ac), "status counts": {s: n for s, r, n in d["status"]}, "gender blank": d["blankGender"],
                 "dup-EPIC groups": g["groups"], "cross-part": g["crossPart"], "with an added row": g["withAdded"],
                 "with a blank-gender row": g["withBlank"], "same age": g["sameAge"], "with a deleted row": g["withDel"]})
pd.DataFrame(rows).set_index("AC")'''))
cells.append(new_code_cell('''# Stamp-scan results (one JSON line per card: page, idx, band, residBand, residFrac, black), when present.
import glob
SCAN = "analysis/stampscan"
BAND_MIN, RESID_MIN = 0.15, 0.04
summary = {}
for ac, folder in (("61", "61-Noida"), ("62", "62-Dadri"), ("63", "63-Jewar")):
    files = glob.glob(f"{SCAN}/{folder}/*.jsonl")
    if not files: continue
    n = stamped = 0
    for f in files:
        for line in open(f):
            x = json.loads(line)
            if "band" not in x or not (0.004 < x["black"] < 0.08) or x["page"] <= 2: continue
            n += 1; stamped += (x["band"] >= BAND_MIN and x["residBand"] >= RESID_MIN)
    summary[ac] = {"parts scanned": len(files), "cards": n, "stamped": stamped, "% stamped": round(100 * stamped / max(n, 1), 2)}
pd.DataFrame(summary).T if summary else "stamp-scan outputs not present (run analysis/stamp_scan.py where the PDFs are)"'''))

cells.append(new_code_cell('''# Aggregates written by analysis/stamp_join.cjs (scan joined to the dashboard rows by part, page and position)
if "stamp" in ST:
    rows = []
    for ac in ORDER:
        if ac not in ST["stamp"]: continue
        s = ST["stamp"][ac]
        rows.append({"AC": label(ac), "parts scanned": s["partsScanned"], "cards": s["cards"], "stamped": s["stamped"], "% stamped": s["stampedPct"],
                     "re-added elsewhere, same age": s["readdedSameAge"], "gender unreadable by OCR": s["blankGender"],
                     "dup-EPIC groups with a stamped member": s["dupGroupsWithStampedMember"], "median age of stamped": s["medianAge"]})
    display(pd.DataFrame(rows).set_index("AC"))
    fig, ax = plt.subplots(figsize=(6, 2.8))
    for ac in ORDER:
        if ac not in ST["stamp"]: continue
        pp = ST["stamp"][ac]["perPart"]; v = [100 * p["stamped"] / p["cards"] for p in pp if p["cards"] > 100]
        ax.hist(v, bins=np.arange(0, 8.5, 0.25), histtype="step", lw=1.3, color=AC_COL[ac], label=f"{label(ac)}: {len(v)} parts, median {np.median(v):.2f}%")
    ax.set_xlabel("Cards printed with the DELETED stamp (% of the part)"); ax.set_ylabel("Parts"); ax.legend(fontsize=7); plt.show()
else:
    print("no stamp aggregates yet")'''))

cells.append(new_markdown_cell("## 5. CPU scaling benchmark (Table 4b)\n\n`analysis/bench/run_bench.sh` ran the same 48 pages at 1, 2, 4, 8 and 10 pages in flight on an idle Apple M4."))
cells.append(new_code_cell('''S = ST["scaling"]; df = pd.DataFrame(S["rows"])
df["cores busy"] = ((df.user_s + df.sys_s) / df.wall_s).round(1); df["CPU-s per page"] = ((df.user_s + df.sys_s) / df.pages).round(1)
df[["conc", "wall_s", "pages_per_s", "cores busy", "CPU-s per page", "max_rss_mb"]].set_index("conc")'''))

cells.append(new_markdown_cell("## 6. Rebuild the paper\n\n```\nNODE_PATH=<folder with the docx module> node build_paper.cjs\n```\nwrites `Making_the_Invisible_Roll_Visible.docx` from the same `data/gbn_stats.json` and the figures above."))

nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
out = os.path.join(HERE, "analysis.ipynb")
nbf.write(nb, out)
print("wrote", out, len(cells), "cells")
if "--execute" in sys.argv:
    from nbclient import NotebookClient
    kernel = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--kernel=")), "python3")
    client = NotebookClient(nb, timeout=600, kernel_name=kernel, resources={"metadata": {"path": HERE}})
    client.execute()
    nb.metadata["kernelspec"] = {"name": "python3", "display_name": "Python 3", "language": "python"}
    nbf.write(nb, out)
    print("executed")
