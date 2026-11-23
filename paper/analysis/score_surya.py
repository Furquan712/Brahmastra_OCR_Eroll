#!/usr/bin/env python3
"""Scores a Surya OCR run (surya_ocr <pages> --langs hi,en --output_dir <out>; Surya 0.13) against the
ocr-eval truth files of the 300-card test set, as a modern-recogniser baseline.
Two scores per field: card-level (the truth string occurs in the text of the lines whose centre falls
inside that card's rectangle on the roll's fixed grid) and page-level (occurs anywhere on the page,
the generous rule used for the single-pass Tesseract baseline).
Usage: score_surya.py <surya_output_dir> <truth_dir>"""
import json, os, re, sys, glob
out_dir, truth_dir = sys.argv[1], sys.argv[2]
X = [59, 851, 1637]; CW = 776; Y0 = 116; PITCH = 331; CH = 310
norm = lambda s: re.sub(r"\s+", " ", str(s)).strip()
results = {}
for f in glob.glob(os.path.join(out_dir, "**", "results.json"), recursive=True):
    results.update(json.load(open(f, encoding="utf8")))
if not results: raise SystemExit("no results.json under " + out_dir)
fields = ["epic", "name", "relName", "house", "age", "gender"]
tot = {k: 0 for k in fields}; tot_page = {k: 0 for k in fields}; cards_ok = 0; n = 0; per_ac = {}
for tf in sorted(glob.glob(os.path.join(truth_dir, "*.json"))):
    t = json.load(open(tf, encoding="utf8")); key = os.path.basename(tf)[:-5]
    page = results.get(key) or results.get(key + ".png")
    if not page: print("missing surya output for", key); continue
    lines = page[0]["text_lines"] if isinstance(page, list) else page["text_lines"]
    page_text = norm(" ".join(l["text"] for l in lines))
    ac = key.split("-")[0]; per_ac.setdefault(ac, [0, 0])
    for i, c in enumerate(t["cards"]):
        r, col = divmod(i, 3); x0, y0 = X[col], Y0 + r * PITCH
        txt = norm(" ".join(l["text"] for l in lines if x0 <= (l["bbox"][0] + l["bbox"][2]) / 2 <= x0 + CW and y0 <= (l["bbox"][1] + l["bbox"][3]) / 2 <= y0 + CH))
        ok_all = True; n += 1; per_ac[ac][1] += 1
        for k in fields:
            want = norm(c[k])
            if want in txt: tot[k] += 1
            else: ok_all = False
            if want in page_text: tot_page[k] += 1
        if ok_all: cards_ok += 1; per_ac[ac][0] += 1
print("cards", n)
for k in fields: print(f"{k:8s} card-level {tot[k]}/{n}  page-level {tot_page[k]}/{n}")
print("cards with all six fields found (card-level):", cards_ok, "/", n, {a: f"{v[0]}/{v[1]}" for a, v in per_ac.items()})
json.dump({"cards": n, "card_level": tot, "page_level": tot_page, "cards_ok": cards_ok, "per_ac": per_ac}, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "surya_baseline.json"), "w"), indent=1)
