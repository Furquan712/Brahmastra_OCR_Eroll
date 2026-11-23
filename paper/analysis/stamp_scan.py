"""Scan electoral-roll PDFs for cards overprinted with the diagonal DELETED stamp.

For every card page: render at DPI, cut the 3x10 card grid (template geometry, row-major),
compute the eroded mid-grey ink fraction of the card body (the stamp is grey, the text is black),
and OCR the serial box (digits + legend letters) so the card can be joined to the dashboard row.
Writes one JSON line per card to <out>/<pdfname>.jsonl. Usage:
  python3 -I stamp_scan.py <pdf_dir> <out_dir> [--dpi 200] [--workers 8] [--only part[,part...]] [--pages a-b]
"""
import sys, os, re, json, subprocess, tempfile, argparse
from concurrent.futures import ProcessPoolExecutor
import numpy as np
from PIL import Image, ImageFilter

BODY = (0.034, 0.962, 0.02, 0.98)   # fallbackBody of templates/default.json
COLS, ROWS = 3, 10
SERIAL_BOX = (0.03, 0.04, 0.29, 0.12)  # left, top, width, height as fractions of the card
LEGEND = "ESRMQD#"

def page_count(pdf):
    out = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
    m = re.search(r"^Pages:\s+(\d+)", out, re.M)
    return int(m.group(1)) if m else 0

def render(pdf, page, dpi, tmp):
    prefix = os.path.join(tmp, f"p{page}")
    subprocess.run(["pdftoppm", "-r", str(dpi), "-f", str(page), "-l", str(page), "-gray", "-png", "-singlefile", pdf, prefix], check=True, timeout=120)
    return Image.open(prefix + ".png").convert("L")

def grey_score(card):
    a = np.asarray(card).astype(int); h, w = a.shape
    body = a[int(0.18 * h):int(0.95 * h), int(0.03 * w):int(0.70 * w)]
    mask = Image.fromarray((((body > 100) & (body < 215)).astype(np.uint8) * 255))
    e = np.asarray(mask.filter(ImageFilter.MinFilter(3))) > 0
    return float(e.mean())

def is_card_page(img):
    """A card page has horizontal rules across most of the width at the card pitch; a cover or summary page does not."""
    a = np.asarray(img) < 140
    rows = a.mean(axis=1)
    dark = np.where(rows > 0.5)[0]
    return len(dark) >= 8

def ocr_serials(crops, tmp):
    if not crops: return []
    lst = os.path.join(tmp, "list.txt"); paths = []
    for i, c in enumerate(crops):
        p = os.path.join(tmp, f"s{i}.png"); c.save(p, dpi=(300, 300)); paths.append(p)
    open(lst, "w").write("\n".join(paths) + "\n")
    r = subprocess.run(["tesseract", lst, "-", "-l", "eng", "--psm", "7", "-c", "tessedit_char_whitelist=0123456789ESRMQD# ", "tsv"],
                       capture_output=True, text=True, timeout=300, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
    per = [[] for _ in crops]
    for line in r.stdout.splitlines()[1:]:
        f = line.split("\t")
        if len(f) < 12 or f[0] != "5": continue
        per[int(f[1]) - 1].append(f[11])
    return [" ".join(x).strip() for x in per]

def scan_pdf(args):
    pdf, out_dir, dpi, pages = args
    name = os.path.basename(pdf); outp = os.path.join(out_dir, name + ".jsonl")
    if os.path.exists(outp): return name, "cached"
    n = page_count(pdf); first, last = (pages or (1, n)); last = min(last, n)
    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for page in range(max(2, first), last + 1):   # page 1 is the cover
            try: img = render(pdf, page, dpi, tmp)
            except Exception as e: rows.append({"page": page, "error": str(e)[:100]}); continue
            if not is_card_page(img): continue
            W, H = img.size; top, bot, left, right = BODY
            bw = (right - left) * W / COLS; bh = (bot - top) * H / ROWS
            cards, crops, meta = [], [], []
            for idx in range(COLS * ROWS):
                r, c = divmod(idx, COLS)
                x0 = int(left * W + c * bw); y0 = int(top * H + r * bh)
                card = img.crop((x0, y0, int(x0 + bw), int(y0 + bh)))
                a = np.asarray(card)
                if a.mean() > 250 and a.std() < 4: continue   # blank cell
                sx, sy, sw, sh = SERIAL_BOX
                sb = card.crop((int(sx * bw), int(sy * bh), int((sx + sw) * bw), int((sy + sh) * bh)))
                pad = Image.new("L", (sb.width + 40, sb.height + 24), 255); pad.paste(sb, (20, 12))
                cards.append(card); crops.append(pad); meta.append(idx)
            texts = ocr_serials(crops, tmp)
            for card, idx, t in zip(cards, meta, texts):
                t = t.replace("  ", " ").strip()
                m = re.match(r"^([ESRMQD#])?\s*(\d)?\s*(\d{1,5})$", t)
                serial = int(m.group(3)) if m else None
                marker = (m.group(1) or "") if m else ""
                rows.append({"page": page, "idx": idx, "serial": serial, "marker": marker, "raw": t, "grey": round(grey_score(card), 5)})
    with open(outp + ".tmp", "w") as f:
        for r in rows: f.write(json.dumps(r) + "\n")
    os.replace(outp + ".tmp", outp)
    return name, len(rows)

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("pdf_dir"); ap.add_argument("out_dir")
    ap.add_argument("--dpi", type=int, default=200); ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--only", default=""); ap.add_argument("--pages", default="")
    a = ap.parse_args(); os.makedirs(a.out_dir, exist_ok=True)
    pdfs = sorted(f for f in os.listdir(a.pdf_dir) if f.lower().endswith(".pdf"))
    if a.only:
        keep = set(a.only.split(","))
        pdfs = [f for f in pdfs if re.search(r"-HIN-(\d+)-WI\.pdf$", f) and re.search(r"-HIN-(\d+)-WI\.pdf$", f).group(1) in keep]
    pages = tuple(int(x) for x in a.pages.split("-")) if a.pages else None
    jobs = [(os.path.join(a.pdf_dir, f), a.out_dir, a.dpi, pages) for f in pdfs]
    done = 0
    with ProcessPoolExecutor(a.workers) as ex:
        for name, res in ex.map(scan_pdf, jobs):
            done += 1
            if done % 10 == 0 or res == "cached": print(f"{done}/{len(jobs)} {name} {res}", flush=True)
    print("done", done)
