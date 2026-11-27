#!/usr/bin/env python3
"""Text lines with positions for each PDF named on the command line (needs PyMuPDF and pdftotext).
Prints one JSON object per PDF: {"file": path, "pages": [[[x0, y0, x1, y1, text], ...], ...]}."""
import html, json, re, subprocess, sys, tempfile
import fitz

# The ECI PDF generator sometimes writes a wrong character map for a glyph: it is drawn correctly
# but extracts as something else (printed "कृष्ण", extracted "कर्ष्ण"), in some files only. These are
# the glyphs found mapped two ways across 296 rolls, with the value that matches the printed shape.
# Subset fonts keep the original glyph ids, so the ids hold for every file using this font.
GLYPHS = {
    "NotoSans-Regular": {
        3755: "\u090b",              # independent vocalic r (extracts as ra: "रषभ" for "ऋषभ")
        3811: "\u0943",              # vocalic r sign
        4144: "\u0939\u0943",         # ha + vocalic r
        4244: "\u091f\u094d\u091f",   # tta + tta
        4249: "\u0920\u094d\u0920",   # ttha + ttha
        4252: "\u0921\u094d\u0921",   # dda + dda
    },
}


def repair_character_maps(doc):
    """Append the right values to each affected font's ToUnicode map (a later entry wins). In memory only."""
    done = set()
    for number in range(doc.page_count):
        for font in doc.get_page_fonts(number, full=True):
            xref, name = font[0], font[3].split("+")[-1]
            if xref in done or name not in GLYPHS:
                continue
            done.add(xref)
            kind, ref = doc.xref_get_key(xref, "ToUnicode")
            if kind != "xref":
                continue
            stream = int(ref.split()[0])
            cmap = doc.xref_stream(stream)
            entries = "".join("<%04x> <%s>\n" % (g, "".join("%04x" % ord(c) for c in u)) for g, u in GLYPHS[name].items())
            block = "%d beginbfchar\n%sendbfchar\nendcmap" % (len(GLYPHS[name]), entries)
            doc.update_stream(stream, cmap.replace(b"endcmap", block.encode(), 1))

# Poppler reads the text, not PyMuPDF: these files carry "ActualText" replacements for reordered
# Hindi clusters, which Poppler applies correctly but PyMuPDF merges with the glyphs, repeating
# letters ("चन्द्रद्र", "गुप्ताता"). Poppler's one fault here is a false space after some vowel signs
# ("दे वी", "तुफ़ै ल"): at card size those gaps measure up to 1.55 pt, real spaces 1.8 pt or more.
WORD = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')
FALSE_SPACE = 0.175  # of the word box height
SEGMENT_GAP = 4.0    # a wider gap starts a separate line (next column, photo label, label/value columns)


def column(x):
    return min(2, max(0, int((x - 14) // 190)))


def fix_order(text):
    # a nukta belongs on its consonant, before the vowel sign ("गुडि़या" -> "गुड़िया")
    return re.sub("([\u093e-\u094c])\u093c", "\u093c\\1", text)


def lines_of(words):
    rows = []
    for w in sorted(words, key=lambda w: (w[1], w[0])):
        if rows and abs(w[1] - rows[-1][0][1]) <= 2:
            rows[-1].append(w)
        else:
            rows.append([w])
    lines = []
    for row in rows:
        row.sort(key=lambda w: w[0])
        line = None
        for x0, y0, x1, y1, text in row:
            gap = x0 - line[2] if line else None
            if line is None or gap > SEGMENT_GAP or column(x0) != column(line[0]) or text.startswith("फोटो"):
                line = [x0, y0, x1, y1, text]
                lines.append(line)
            else:
                line[4] += ("" if gap < FALSE_SPACE * (y1 - y0) else " ") + text
                line[2] = max(line[2], x1)
                line[3] = max(line[3], y1)
    return [[round(v, 1) for v in l[:4]] + [l[4]] for l in lines]


def read_pdf(path):
    doc = fitz.open(path)
    repair_character_maps(doc)
    with tempfile.NamedTemporaryFile(suffix=".pdf") as repaired:
        doc.save(repaired.name)
        xml = subprocess.run(["pdftotext", "-bbox", repaired.name, "-"], check=True, capture_output=True,
                             text=True, encoding="utf-8").stdout
    pages = []
    for chunk in xml.split("<page ")[1:]:
        words = [(float(a), float(b), float(c), float(d), fix_order(html.unescape(t))) for a, b, c, d, t in WORD.findall(chunk)]
        pages.append(lines_of(words))
    return pages


for path in sys.argv[1:]:
    try:
        out = {"file": path, "pages": read_pdf(path)}
    except Exception as e:
        out = {"file": path, "error": str(e)}
    print(json.dumps(out, ensure_ascii=False), flush=True)
