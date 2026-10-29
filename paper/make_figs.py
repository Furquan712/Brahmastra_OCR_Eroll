import csv, json, glob, collections
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch
import numpy as np

OUT = "figures/"
BLUE, ORANGE, AQUA, YELLOW, MAG = "#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"
INK, INK2, MUTED, GRID, AXIS = "#0b0b0b", "#52514e", "#898781", "#e1e0d9", "#c3c2b7"
plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 9, "axes.edgecolor": AXIS, "axes.labelcolor": INK2,
    "xtick.color": MUTED, "ytick.color": MUTED, "axes.spines.top": False, "axes.spines.right": False,
    "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6, "axes.axisbelow": True,
    "figure.facecolor": "white", "axes.facecolor": "white", "savefig.dpi": 220, "legend.frameon": False,
})

def save(name):
    plt.tight_layout(); plt.savefig(OUT + name, bbox_inches="tight"); plt.close()

def bars(ax, x, h, color, w=0.6, label=None):
    return ax.bar(x, h, width=w, color=color, edgecolor="white", linewidth=1, label=label)

# ---------- Fig 2: pipeline diagram ----------
fig, ax = plt.subplots(figsize=(7.2, 3.2)); ax.axis("off"); ax.grid(False)
steps = [("ECI CDN\nPDF (raster)", "#e8f0fb"), ("pdftoppm\n300 dpi", "#e8f0fb"),
         ("Page classify\ncover / roll /\nsupplement", "#e8f0fb"), ("Grid & card\ndetection", "#e8f0fb"),
         ("Multi-pass\nTesseract\n+ voting", "#fdebe3"), ("Page + PDF\nconsensus\nname memory", "#fdebe3"),
         ("Translit.\nHindi→Roman", "#e3f5ee"), ("Validate\n& flag", "#fff4dd"), ("CSV +\nsummary", "#eeeeee")]
n = len(steps); xs = np.linspace(0.065, 0.935, n)
for (t, c), x in zip(steps, xs):
    ax.add_patch(FancyBboxPatch((x - 0.047, 0.35), 0.094, 0.42, boxstyle="round,pad=0.01", fc=c, ec=AXIS, lw=0.8, transform=ax.transAxes))
    ax.text(x, 0.56, t, ha="center", va="center", fontsize=7.2, color=INK, transform=ax.transAxes)
for a, b in zip(xs[:-1], xs[1:]):
    ax.annotate("", xy=(b - 0.049, 0.56), xytext=(a + 0.049, 0.56), xycoords="axes fraction",
                arrowprops=dict(arrowstyle="->", color=INK2, lw=0.9))
ax.text(0.5, 0.12, "Stage colours: blue = layout & I/O, orange = recognition & repair, green = transliteration, yellow = quality control.\n"
        "Uncertain cards are flagged for review, never dropped. No network call is made in the local engine.",
        ha="center", va="center", fontsize=7.2, color=INK2, transform=ax.transAxes)
save("fig2_pipeline.png")

# ---------- Fig 3: accuracy vs baseline (Dadri page, n=30) ----------
fields = ["EPIC", "Name\n(Devanagari)", "Relation\nname", "Card fully\ncorrect*"]
base = [23, 24, 27, 18]; full = [30, 29, 29, 27]
x = np.arange(len(fields)); w = 0.36
fig, ax = plt.subplots(figsize=(5.6, 3.1))
b1 = bars(ax, x - w / 2, base, AXIS, w, "Single-pass Tesseract (eng+hin)")
b2 = bars(ax, x + w / 2, full, BLUE, w, "Consensus pipeline (local engine)")
for r in list(b1) + list(b2):
    ax.text(r.get_x() + r.get_width() / 2, r.get_height() + 0.4, f"{int(r.get_height())}/30", ha="center", fontsize=7.5, color=INK2)
ax.set_xticks(x); ax.set_xticklabels(fields); ax.set_ylim(0, 33); ax.set_ylabel("Correct cards (of 30)")
ax.legend(loc="lower left", fontsize=7.5)
save("fig3_accuracy_vs_baseline.png")

# ---------- Fig 4: flag calibration (Dadri) ----------
fig, ax = plt.subplots(figsize=(5.2, 2.4))
cats = ["Not flagged", "Flagged for review"]
correct = [17, 10]; wrong = [1, 2]
ax.barh(cats, correct, color=BLUE, edgecolor="white", label="Card correct")
ax.barh(cats, wrong, left=correct, color=ORANGE, edgecolor="white", label="Card has an error")
for i, (c, w_) in enumerate(zip(correct, wrong)):
    ax.text(c / 2, i, f"{c}", ha="center", va="center", color="white", fontsize=8)
    ax.text(c + w_ / 2, i, f"{w_}", ha="center", va="center", color="white", fontsize=8)
ax.set_xlabel("Cards (n = 30, hand-checked page)"); ax.legend(fontsize=7.5, loc="lower right")
save("fig4_flag_calibration.png")

# ---------- Fig 5: transliteration ablation ----------
fig, ax = plt.subplots(figsize=(4.6, 2.8))
labels = ["Rules only", "Rules + learned\nre-ranker", "Full engine\n(+ lexicon, overrides)"]
vals = [86.7, 92.0, 100.0]
b = bars(ax, np.arange(3), vals, [AXIS, "#86b6ef", BLUE])
for r, v, k in zip(b, vals, [98, 104, 113]):
    ax.text(r.get_x() + r.get_width() / 2, v + 1.2, f"{v:.1f}%  ({k}/113)", ha="center", fontsize=7.5, color=INK2)
ax.set_xticks(range(3)); ax.set_xticklabels(labels); ax.set_ylim(0, 112); ax.set_ylabel("Exact match on held-out names (%)")
save("fig5_translit_ablation.png")

# ---------- Jewargi data ----------
summ = json.load(open("/Users/furquan/OCR/Brahmastra_OCR/output/Karnataka/35-Jewargi-2026/Karnataka-35-Jewargi-2026-Draft.summary.json"))
rows = list(csv.DictReader(open("/Users/furquan/OCR/Brahmastra_OCR/output/Karnataka/35-Jewargi-2026/Karnataka-35-Jewargi-2026-Draft1.csv")))

# Fig 6: flag counts across 13 parts
fc = sorted(summ["flagCounts"].items(), key=lambda kv: kv[1])
fig, ax = plt.subplots(figsize=(6.2, 4.2))
ax.barh([k for k, _ in fc], [v for _, v in fc], color=BLUE, edgecolor="white")
for i, (k, v) in enumerate(fc):
    ax.text(v + 30, i, f"{v:,}  ({100*v/summ['rows']:.1f}%)", va="center", fontsize=7, color=INK2)
ax.set_xlim(0, 3900); ax.set_xlabel(f"Rows carrying the flag (of {summ['rows']:,} rows, 13 booths, Jewargi draft roll)")
save("fig6_jewargi_flags.png")

# Fig 7: confidence histogram, part 1
conf = [float(r["_ocr_confidence"]) for r in rows]
fig, ax = plt.subplots(figsize=(5.4, 2.9))
ax.hist(conf, bins=np.arange(0, 1.0001, 0.05), color=BLUE, edgecolor="white")
ax.axvline(0.7, color=ORANGE, lw=1.2, ls="--"); ax.text(0.705, ax.get_ylim()[1] * 0.9, "low_confidence\nthreshold 0.70", fontsize=7.5, color=ORANGE)
ax.set_xlabel("Per-card OCR confidence (Jewargi part 1, n = 749)"); ax.set_ylabel("Cards")
save("fig7_confidence_hist.png")

# Fig 8: age–gender pyramid part 1 (ages 18+ only; under-18 reads are flagged OCR errors)
bins = [(18, 25), (26, 35), (36, 45), (46, 55), (56, 65), (66, 75), (76, 120)]
lab = [f"{a}–{b}" if b < 120 else f"{a}+" for a, b in bins]
def cnt(g): return [sum(1 for r in rows if r["Gender_eg"] == g and r["age"].isdigit() and a <= int(r["age"]) <= b) for a, b in bins]
m, f = cnt("Male"), cnt("Female")
fig, ax = plt.subplots(figsize=(5.4, 3.0))
ax.barh(lab, [-v for v in m], color=BLUE, edgecolor="white", label=f"Male (n={sum(m)})")
ax.barh(lab, f, color=ORANGE, edgecolor="white", label=f"Female (n={sum(f)})")
mx = max(max(m), max(f)) + 10; ax.set_xlim(-mx, mx)
ax.set_xticks([-80, -40, 0, 40, 80]); ax.set_xticklabels([80, 40, 0, 40, 80])
ax.set_xlabel("Electors (Jewargi part 1, OCR-read ages ≥ 18)"); ax.legend(fontsize=7.5, loc="lower right")
save("fig8_age_pyramid.png")

# Fig 9: household size distribution part 1
hh = collections.Counter((r["house_no"].strip().lower().lstrip("0") or "0") for r in rows if r["house_no"].strip())
sizes = collections.Counter(hh.values())
bands = [("1", 1, 1), ("2–3", 2, 3), ("4–5", 4, 5), ("6–8", 6, 8), ("9–12", 9, 12), ("13+", 13, 999)]
vals = [sum(v for s, v in sizes.items() if a <= s <= b) for _, a, b in bands]
fig, ax = plt.subplots(figsize=(4.8, 2.8))
b = bars(ax, range(len(bands)), vals, BLUE)
for r, v in zip(b, vals): ax.text(r.get_x() + r.get_width() / 2, v + 1, str(v), ha="center", fontsize=7.5, color=INK2)
ax.set_xticks(range(len(bands))); ax.set_xticklabels([n for n, _, _ in bands])
ax.set_xlabel(f"Electors sharing one house number (part 1, {len(hh)} distinct house numbers)"); ax.set_ylabel("Households")
save("fig9_household_size.png")

# Fig 10: cards per booth
pp = [p for p in summ["perPdf"] if p["status"] == "ok"]
fig, ax = plt.subplots(figsize=(5.8, 2.8))
b = bars(ax, range(len(pp)), [p["cards"] for p in pp], BLUE)
for r, p in zip(b, pp): ax.text(r.get_x() + r.get_width() / 2, p["cards"] + 12, f"{p['cards']}", ha="center", fontsize=6.8, color=INK2)
ax.set_xticks(range(len(pp))); ax.set_xticklabels([p["partNo"] for p in pp]); ax.set_xlabel("Part (booth) number, Jewargi AC-35 draft roll 2026")
ax.set_ylabel("Elector cards read"); ax.set_ylim(0, 1150)
save("fig10_cards_per_booth.png")

# Fig 11: UP corpus coverage
acs = {}
for fpath in glob.glob("/Users/furquan/OCR/Brahmastra_OCR/raw-data/_reports/Uttar Pradesh/batch_download_*.csv"):
    for r in csv.DictReader(open(fpath, encoding="utf-8-sig")):
        if r["AC"] not in acs or int(r["On disk"]) > int(acs[r["AC"]]["On disk"]): acs[r["AC"]] = r
pub = sorted([r for r in acs.values() if int(r["Published"]) > 0], key=lambda r: int(r["AC"]))
fig, ax = plt.subplots(figsize=(6.4, 6.0))
y = np.arange(len(pub))
ax.barh(y, [int(r["Published"]) for r in pub], color="#cde2fb", edgecolor="white", label="Parts published on ECI CDN")
ax.barh(y, [int(r["On disk"]) for r in pub], color=BLUE, edgecolor="white", label="Parts retrieved")
ax.set_yticks(y); ax.set_yticklabels([f"{r['AC']} {r['AC Name']}" for r in pub], fontsize=7); ax.invert_yaxis()
ax.set_xlabel("Parts (one PDF per polling station)"); ax.legend(fontsize=7.5, loc="lower right")
save("fig11_up_corpus.png")

# Table data dump
tot_pub = sum(int(r["Published"]) for r in pub); tot_disk = sum(int(r["On disk"]) for r in pub)
tot_gb = sum(int(r["Bytes on disk"]) for r in pub) / 1e9
json.dump({"up_acs": len(pub), "up_parts_pub": tot_pub, "up_parts_disk": tot_disk, "up_gb": round(tot_gb, 1),
           "p1_hh": len(hh), "p1_rows": len(rows), "male": sum(m), "female": sum(f), "hh_bands": dict(zip([n for n,_,_ in bands], vals)),
           "pyramid": {"labels": lab, "m": m, "f": f}}, open("figs/stats.json", "w"), indent=1)
print("done", tot_pub, tot_disk, tot_gb)
