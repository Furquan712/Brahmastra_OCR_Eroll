#!/usr/bin/env python3
"""Splits data/translit/eval.tsv into the names that also occur in data/translit/seed-names.tsv
(seen) and those that do not (unseen), for Table 3 of the paper. Writes eval_seen.tsv and
eval_unseen.tsv next to this script; score each with `node dist/cli.js translit-eval <file>`."""
import os, sys
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
d = os.path.join(root, "data", "translit")
seed = {l.split("\t")[0].strip() for l in open(os.path.join(d, "seed-names.tsv"), encoding="utf8") if "\t" in l}
out = {k: open(os.path.join(os.path.dirname(os.path.abspath(__file__)), f"eval_{k}.tsv"), "w", encoding="utf8") for k in ("seen", "unseen")}
n = {"seen": 0, "unseen": 0}
for l in open(os.path.join(d, "eval.tsv"), encoding="utf8"):
    if "\t" not in l: continue
    k = "seen" if l.split("\t")[0].strip() in seed else "unseen"
    out[k].write(l); n[k] += 1
print(n)
