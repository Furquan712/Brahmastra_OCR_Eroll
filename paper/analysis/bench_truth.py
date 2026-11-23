#!/usr/bin/env python3
"""Writes an ocr-eval truth file from a terse transcription.
Usage: bench_truth.py <out.json> <pdf-path-relative-to-project-root> <page> < lines
Each line: epic|name|rel|relName|house|age|gender   (rel/gender as printed: पिता/पति/माता, पुरुष/महिला/अन्य)
Serial is the printed serial number: first card = --first argument. Lines starting with # are ignored."""
import json, sys
out, pdf, page = sys.argv[1], sys.argv[2], int(sys.argv[3])
cards = []
for line in sys.stdin:
    line = line.strip()
    if not line or line.startswith("#"): continue
    epic, name, rel, relName, house, age, gender = [x.strip() for x in line.split("|")]
    cards.append({"serial": len(cards) + 1, "epic": epic, "name": name, "rel": rel, "relName": relName, "house": house, "age": int(age), "gender": gender})
json.dump({"pdf": pdf, "page": page, "note": "Transcribed from the 300-dpi rendering by a vision-language model (Claude), serial = grid order; see paper Section 4.3.", "cards": cards},
          open(out, "w", encoding="utf8"), ensure_ascii=False, indent=0)
print(out, len(cards), "cards")
