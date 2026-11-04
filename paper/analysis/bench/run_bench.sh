#!/bin/zsh
# Controlled throughput benchmark: same 4 PDFs (first 12 pages each), local engine,
# page-concurrency 1,2,4,8,10 on an otherwise idle Apple M4 (10 cores).
set -u
B=/private/tmp/claude-501/-Users-Shared-OCR/d2b5fd08-444f-4984-a4bf-57099a44023c/scratchpad/bench
P=/Users/furquan/OCR/Brahmastra_OCR
AC="$B/raw/Uttar Pradesh/131-Katra-2026-Final"
mkdir -p "$AC"
# wait until all 4 PDFs are complete (pdfinfo succeeds)
for i in $(seq 1 60); do
  ok=0; for f in "$B"/pdfs/*.pdf; do pdfinfo "$f" >/dev/null 2>&1 && ok=$((ok+1)); done
  [ "$ok" -ge 4 ] && break; sleep 10
done
ln -sf "$B"/pdfs/*.pdf "$AC"/
cd "$P"
echo "conc,wall_s,pages,pages_per_s,rows,max_rss_mb,user_s,sys_s" > "$B/results.csv"
for c in 1 2 4 8 10; do
  rm -rf "$B/cache" "$B/out" "$B/tmp"; mkdir -p "$B/cache" "$B/out" "$B/tmp"
  echo "=== page-concurrency $c  $(date)"
  /usr/bin/time -l -o "$B/time_$c.txt" env OCR_ENGINE=local OCR_PUSH=false \
    node dist/cli.js run "$AC" --force --no-learn --concurrency 2 --page-concurrency $c \
    --cache "$B/cache" --out "$B/out" --tmp "$B/tmp" --limit-pages 12 > "$B/run_$c.log" 2>&1
  S=$(find "$B/out" -name '*.summary.json' | head -1)
  python3 - "$S" "$B/time_$c.txt" "$c" "$B/results.csv" <<'EOF'
import json,sys,re
s=json.load(open(sys.argv[1])); t=open(sys.argv[2]).read()
rss=int(re.search(r'(\d+)\s+maximum resident set size',t).group(1))/1e6
real=float(re.search(r'([\d.]+)\s+real',t).group(1)); user=float(re.search(r'([\d.]+)\s+user',t).group(1)); sysm=float(re.search(r'([\d.]+)\s+sys',t).group(1))
row=f"{sys.argv[3]},{real:.1f},{s['pages']},{s['pagesPerSec']},{s['rows']},{rss:.0f},{user:.1f},{sysm:.1f}"
print(row); open(sys.argv[4],'a').write(row+"\n")
EOF
done
echo DONE
