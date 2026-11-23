#!/usr/bin/env python3
"""Draws a synthetic Uttar Pradesh roll page (3 x 10 cards, same geometry and labels as the SIR final
roll) with invented names and EPIC numbers, writes it as a one-page 300-dpi PDF under
test/fixtures/synthetic/Uttar Pradesh/00-Synthetic-2026-Final/ and the matching ocr-eval truth file.
No real elector appears on it. Needs Pillow and a Devanagari font (macOS: Kohinoor Devanagari / Devanagari MT).
Usage: make_synthetic_page.py [--seed N]"""
import json, os, random, sys
from PIL import Image, ImageDraw, ImageFont
seed = int(sys.argv[sys.argv.index("--seed") + 1]) if "--seed" in sys.argv else 7
random.seed(seed)
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT_DIR = os.path.join(ROOT, "test", "fixtures", "synthetic", "Uttar Pradesh", "00-Synthetic-2026-Final")
PDF = os.path.join(OUT_DIR, "2026-EROLLGEN-S24-00-SIR-FinalRoll-Revision1-HIN-1-WI.pdf")
TRUTH = os.path.join(ROOT, "test", "fixtures", "synthetic-page.json")
FONTS = ["/System/Library/Fonts/Supplemental/Kohinoor.ttc", "/System/Library/Fonts/Supplemental/DevanagariMT.ttc", "/System/Library/Fonts/Kohinoor.ttc", "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf", "/usr/share/fonts/truetype/lohit-devanagari/Lohit-Devanagari.ttf"]
LATIN = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
def font(paths, size):
    for p in paths:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    raise SystemExit("no usable font found; install a Devanagari font")
W, H = 2480, 3509
im = Image.new("L", (W, H), 255); d = ImageDraw.Draw(im)
hi = font(FONTS, 34); hi_small = font(FONTS, 30); lat = font(LATIN, 34); lat_small = font(LATIN, 30)
# invented names (common Hindi given names and surnames, combined at random: no real elector is intended)
GIVEN_M = ["रमेश", "सुरेश", "विनोद", "अजय", "संजय", "राकेश", "मुकेश", "दिनेश", "अनिल", "सुनील", "राजेश", "महेश", "नरेश", "प्रकाश", "अरुण", "विजय", "मनोज", "अशोक", "राहुल", "अमित"]
GIVEN_F = ["सीमा", "रीना", "मीना", "पूनम", "सुनीता", "अनीता", "गीता", "सरिता", "कविता", "ममता", "रेखा", "उषा", "निशा", "आशा", "नीलम", "किरन", "संगीता", "प्रीति", "ज्योति", "शालिनी"]
SUR = ["कुमार", "शर्मा", "वर्मा", "गुप्ता", "सिंह", "यादव", "देवी", "भाटी", "कश्यप", "सैनी", "चौहान", "त्यागी", "पाल", "राठौर", "मिश्रा"]
HOUSES = ["12", "45", "बी-12", "B-204", "विलेज़", "101, टॉवर-ए", "7/3", "एन-1702", "203", "घ-3बी"]
cards = []
for i in range(30):
    female = random.random() < 0.47
    name = random.choice(GIVEN_F if female else GIVEN_M) + " " + random.choice(SUR)
    rel = "पति" if (female and random.random() < 0.7) else "पिता"
    relName = random.choice(GIVEN_M) + " " + random.choice(SUR)
    cards.append({"serial": i + 1, "epic": "ABK" + "".join(random.choice("0123456789") for _ in range(7)), "name": name, "rel": rel, "relName": relName,
                  "house": random.choice(HOUSES), "age": random.randint(18, 88), "gender": "महिला" if female else "पुरुष"})
# header (section line as in the roll) and footer
d.text((60, 20), "निर्वाचक नामावली -2026 ,विधानसभा निर्वाचन क्षेत्र: : 00-कृत्रिम", font=hi, fill=0)
d.text((60, 60), "अनुभाग संख्या और नाम :  1-कृत्रिम अनुभाग", font=hi, fill=0)
d.text((2120, 20), "भाग संख्या : : 1", font=hi, fill=0)
d.text((60, 3440), "अर्हता दिनांक : 01-01-2026 के अनुसार आयु", font=hi_small, fill=0)
d.text((1050, 3440), "प्रकाशन की तिथि :- 10-04-2026", font=hi_small, fill=0)
d.text((2080, 3440), "कुल पृष्ठ 1 - पृष्ठ 1", font=hi_small, fill=0)
X = [59, 851, 1637]; CW = 776; CH = 310; Y0 = 116; PITCH = 331
for i, c in enumerate(cards):
    r, col = divmod(i, 3); x, y = X[col], Y0 + r * PITCH
    d.rectangle((x, y, x + CW, y + CH), outline=0, width=3)
    d.rectangle((x + 8, y + 8, x + 255, y + 55), outline=0, width=2)              # serial box
    d.text((x + 200, y + 14), str(c["serial"]), font=lat, fill=0)
    d.text((x + 760 - d.textlength(c["epic"], font=lat), y + 14), c["epic"], font=lat, fill=0)  # EPIC top right, right-aligned inside the card
    d.rectangle((x + 585, y + 70, x + 760, y + 290), outline=0, width=3)            # photo box
    d.text((x + 592, y + 165), "फोटो उपलब्ध है", font=hi_small, fill=0)
    d.text((x + 15, y + 78), f"नाम : {c['name']}", font=hi, fill=0)
    d.text((x + 15, y + 118), f"{c['rel']} का नाम: {c['relName']}", font=hi, fill=0)
    d.text((x + 15, y + 158), f"मकान संख्या : {c['house']}", font=hi, fill=0)
    d.text((x + 15, y + 198), f"आयु : {c['age']} लिंग : {c['gender']}", font=hi, fill=0)
os.makedirs(OUT_DIR, exist_ok=True)
im.save(PDF, "PDF", resolution=300.0)
im.save(PDF[:-4] + ".png", dpi=(300, 300))
json.dump({"pdf": os.path.relpath(PDF, ROOT), "page": 1, "note": f"Synthetic page: invented names and EPIC numbers (seed {seed}), drawn by paper/analysis/make_synthetic_page.py. Serial = printed serial.", "cards": cards},
          open(TRUTH, "w", encoding="utf8"), ensure_ascii=False, indent=1)
print(PDF); print(TRUTH, len(cards), "cards")
