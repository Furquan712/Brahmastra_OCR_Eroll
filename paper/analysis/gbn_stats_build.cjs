// Rebuilds ../data/gbn_stats.json (every number in the paper) from the dashboard's rows in one pass.
// Replaces the ad-hoc gbn_stats.cjs … gbn_stats4.cjs sequence. Reads rows per chunk of parts (Atlas
// times out on one large find), keeps only the fields it needs, and computes all booth-level aggregates
// in memory. Rows with actionStatus "deleted" (cards printed with the DELETED stamp, final build) are
// counted as cards but excluded from every structural figure; for a roll read before the detector
// existed, the pixel-scan outputs under analysis/stampscan/<ac-folder> are joined by page position
// and the matched cards are treated the same way (recorded as deletedSource: "scan-join").
// Also computes the cross-constituency EPIC analysis (crossAc) used in Section 8.4.
// Usage: NODE_PATH=<dashboard node_modules> node gbn_stats_build.cjs [--dry]
// Preserves press, benchmark, translit, scaling, stamp, jewarRun and per-AC bytes from the existing file.
const fs = require("node:fs"), path = require("node:path");
const { MongoClient } = require("mongodb");
const DASH = "/Volumes/External/algo/Brahmastra_Dashboard";
const OUT = path.join(__dirname, "..", "data", "gbn_stats.json");
const SCAN = path.join(__dirname, "stampscan");
const RUNS = process.env.RUNS_DIR || path.join(__dirname, "runs");
const BAND_MIN = 0.15, RESID_MIN = 0.04;
const ACS = { 61: { name: "Noida", folder: "61-Noida" }, 62: { name: "Dadri", folder: "62-Dadri" }, 63: { name: "Jewar", folder: "63-Jewar" } };
const BANDS = [[18, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 69], [70, 79], [80, 200]];
const LABELS = ["18–19", "20–29", "30–39", "40–49", "50–59", "60–69", "70–79", "80+"];
const env = Object.fromEntries(fs.readFileSync(path.join(DASH, ".env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
  .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).replace(/\s*#.*$/, "").trim().replace(/^["']|["']$/g, "")]; }));

const num = (x) => { const n = typeof x === "number" ? x : parseInt(String(x ?? "").replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : null; };
const pctile = (arr, q) => { if (!arr.length) return 0; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * a.length))]; };
const median = (arr) => pctile(arr, 0.5);
const normName = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const normHouse = (s) => String(s ?? "").toUpperCase().replace(/^(H\.?\s*NO\.?|HNO|H\.?N\.?|MAKAN)\s*[-:.]*\s*/i, "").replace(/[\s\-.\/,:]+/g, "").trim();
const epicClass = (e) => { e = String(e ?? ""); if (!e) return "empty"; if (/^[A-Z]{3}\d{7}$/.test(e)) return "modern"; if (e.includes("/")) return "slash"; if (/^[A-Z]{3}\d{6}$/.test(e)) return "3L6D"; if (/^[A-Z]{2}\d/.test(e)) return "2L"; return "other"; };
const band = (a) => { for (let i = 0; i < BANDS.length; i++) if (a >= BANDS[i][0] && a <= BANDS[i][1]) return i; return -1; };

async function fetchRows(v, key, parts, chunk = 20) {
  const rows = [];
  const proj = { partNo: 1, pageNo: 1, serialNo: 1, epicNo: 1, nameHi: 1, relationTypeEg: 1, houseNo: 1, age: 1, gender: 1, sectionNo: 1, actionStatus: 1, flags: 1 };
  for (let i = 0; i < parts.length; i += chunk) {
    const slice = parts.slice(i, i + chunk);
    for (let attempt = 1; ; attempt++) {
      try {
        const got = await v.find({ key, source: "main", partNo: { $in: slice } }, { projection: proj }).toArray();
        for (const r of got) rows.push({ id: String(r._id), part: String(r.partNo), page: num(r.pageNo), serial: num(r.serialNo), epic: String(r.epicNo ?? ""), name: normName(r.nameHi),
          rel: r.relationTypeEg ?? "", house: r.houseNo ?? "", age: num(r.age), g: r.gender ?? "", sec: String(r.sectionNo ?? ""), st: r.actionStatus ?? "", flags: r.flags ?? "", del: r.actionStatus === "deleted" });
        break;
      } catch (e) { if (attempt >= 5) throw e; process.stderr.write(`  retry ${attempt}: ${e.message}\n`); await new Promise((r) => setTimeout(r, 3000 * attempt)); }
    }
    process.stderr.write(`\r  ${key.split("::")[1]}: ${Math.min(i + chunk, parts.length)}/${parts.length} parts, ${rows.length} rows`);
  }
  process.stderr.write("\n");
  return rows;
}

// Marks scan-detected stamped cards as deleted when the pipeline run predates the detector.
function joinScan(rows, folder) {
  const dir = path.join(SCAN, folder);
  if (!fs.existsSync(dir)) return { applied: false };
  const byPage = new Map();
  for (const r of rows) { const k = `${r.part}:${r.page}`; (byPage.get(k) || byPage.set(k, []).get(k)).push(r); }
  let cards = 0, stamped = 0, joined = 0, marked = 0;
  for (const f of fs.readdirSync(dir)) {
    const m = /-HIN-(\d+)-WI\.pdf\.jsonl$/.exec(f); if (!m) continue;
    const pages = new Map();
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line) continue; const x = JSON.parse(line);
      if (!("band" in x) || x.page <= 2 || !(x.black > 0.004 && x.black < 0.08)) continue;
      (pages.get(x.page) || pages.set(x.page, []).get(x.page)).push(x);
    }
    for (const [page, xs] of pages) {
      xs.sort((a, b) => a.idx - b.idx); cards += xs.length;
      const rs = (byPage.get(`${m[1]}:${page}`) || []).sort((a, b) => a.serial - b.serial);
      for (let i = 0; i < xs.length; i++) {
        const isStamped = xs[i].band >= BAND_MIN && xs[i].residBand >= RESID_MIN;
        if (isStamped) stamped++;
        if (rs.length === xs.length) { joined++; if (isStamped && !rs[i].del) { rs[i].del = true; rs[i].st = "deleted"; marked++; } }
      }
    }
  }
  return { applied: true, cards, stamped, joined, marked };
}

function acStats(rows) {
  const live = rows.filter((r) => !r.del);
  const o = {};
  o.rows = rows.length; o.deleted = rows.length - live.length; o.electors = live.length;
  // per part
  const parts = new Map();
  for (const r of rows) {
    const p = parts.get(r.part) || parts.set(r.part, { part: r.part, n: 0, e: 0, d: 0, m: 0, f: 0, maxSerial: 0, secs: new Set(), added: 0, modified: 0, pages: 0 }).get(r.part);
    p.n++; if (r.del) p.d++; else { p.e++; if (r.g === "M") p.m++; if (r.g === "F") p.f++; }
    if (r.serial != null && r.serial > p.maxSerial) p.maxSerial = r.serial;
    if (r.page != null && r.page > p.pages) p.pages = r.page;
    p.secs.add(r.sec); if (r.st === "added") p.added++; if (r.st === "modified") p.modified++;
  }
  o.perPart = [...parts.values()].map((p) => ({ part: p.part, n: p.n, e: p.e, d: p.d, m: p.m, f: p.f, maxSerial: p.maxSerial, sections: p.secs.size })).sort((a, b) => +a.part - +b.part);
  o.parts = o.perPart.length;
  o.pages = [...parts.values()].reduce((s, p) => s + p.pages, 0);
  for (const p of o.perPart) if (p.maxSerial > 1.5 * p.n + 100) { const q = rows.filter((r) => r.part === p.part && r.serial != null && r.serial <= 1.5 * p.n + 100).map((r) => r.serial); p.maxSerial = q.length ? Math.max(...q) : p.n; } // one misread serial (8348 for 348) must not set a part's size
  o.maxSerialSum = o.perPart.reduce((s, p) => s + p.maxSerial, 0);
  o.shortParts98 = o.perPart.filter((p) => p.maxSerial && p.n / p.maxSerial < 0.98).length;
  o.shortParts90 = o.perPart.filter((p) => p.maxSerial && p.n / p.maxSerial < 0.90).length;
  const sizes = o.perPart.map((p) => p.e);
  o.partSize = { min: Math.min(...sizes), p5: pctile(sizes, 0.05), median: median(sizes), p95: pctile(sizes, 0.95), max: Math.max(...sizes), lt300: sizes.filter((x) => x < 300).length, gt1200: sizes.filter((x) => x > 1200).length };
  // gender, ages (live rows)
  o.gender = { M: 0, F: 0, O: 0, "": 0 };
  for (const r of live) o.gender[r.g in o.gender ? r.g : ""]++;
  o.sexRatio = Math.round(1000 * o.gender.F / o.gender.M);
  const pyr = { labels: LABELS, M: Array(8).fill(0), F: Array(8).fill(0) }, hist = {}, agesAll = [], agesM = [], agesF = [];
  o.ageLt18 = { total: 0, zero: 0, a1_9: 0, a10_17: 0, a17: 0, gt120: 0 }; o.ageUnread = 0; o.age18_19 = 0; o.age80plus = 0;
  for (const r of live) {
    const a = r.age;
    if (a == null) { o.ageUnread++; continue; }
    if (a < 18) { o.ageLt18.total++; o.ageLt18.hist = o.ageLt18.hist || {}; o.ageLt18.hist[a] = (o.ageLt18.hist[a] || 0) + 1; if (a === 0) o.ageLt18.zero++; else if (a <= 9) o.ageLt18.a1_9++; else { o.ageLt18.a10_17++; if (a === 17) o.ageLt18.a17++; } continue; }
    if (a > 120) { o.ageLt18.gt120++; continue; }
    hist[a] = (hist[a] || 0) + 1; agesAll.push(a);
    if (r.g === "M") { agesM.push(a); pyr.M[band(a)]++; } else if (r.g === "F") { agesF.push(a); pyr.F[band(a)]++; }
    if (a <= 19) o.age18_19++; if (a >= 80) o.age80plus++;
  }
  o.ageBad = o.ageLt18.total + o.ageLt18.gt120;
  o.pyramid = pyr; o.ageHist = hist; o.medianAge = { M: median(agesM), F: median(agesF), all: median(agesAll) };
  // households (live rows with a house number) within part+section
  const hh = new Map(); o.hhElectors = 0;
  for (const r of live) { const h = normHouse(r.house); if (!h) continue; o.hhElectors++; const k = `${r.part}|${r.sec}|${h}`; hh.set(k, (hh.get(k) || 0) + 1); }
  o.households = hh.size; o.hhSize = { "1": 0, "2-3": 0, "4-5": 0, "6-9": 0, "10+": 0 }; o.hhMax = 0;
  for (const n of hh.values()) { o.hhSize[n === 1 ? "1" : n <= 3 ? "2-3" : n <= 5 ? "4-5" : n <= 9 ? "6-9" : "10+"]++; if (n > o.hhMax) o.hhMax = n; }
  // sections, status, relation, epic patterns
  o.sections = new Set(rows.map((r) => `${r.part}|${r.sec}`)).size;
  o.action = { existing: 0, added: 0, modified: 0, deleted: 0 };
  for (const r of rows) o.action[r.st in o.action ? r.st : "existing"]++;
  o.statusCounts = { ...o.action };
  o.relation = { Father: 0, Husband: 0, Mother: 0, "": 0 }; o.relByGender = {};
  for (const r of live) { const rel = r.rel in o.relation ? r.rel : ""; o.relation[rel]++; const k = `${r.g}|${rel}`; o.relByGender[k] = (o.relByGender[k] || 0) + 1; }
  o.epicPat = { modern: 0, slash: 0, "3L6D": 0, "2L": 0, other: 0, empty: 0 };
  for (const r of live) o.epicPat[epicClass(r.epic)]++;
  o.emptyName = live.filter((r) => !r.name).length;
  o.blankGenderByStatus = {};
  for (const r of rows) if (!r.g) o.blankGenderByStatus[r.st || "existing"] = (o.blankGenderByStatus[r.st || "existing"] || 0) + 1;
  // duplicate EPICs within the constituency (all cards, including deleted ones)
  const byEpic = new Map();
  for (const r of rows) if (epicClass(r.epic) === "modern") (byEpic.get(r.epic) || byEpic.set(r.epic, []).get(r.epic)).push(r);
  const groups = [...byEpic.values()].filter((g) => g.length > 1);
  o.dupEpics = groups.length; o.dupRows = groups.reduce((s, g) => s + g.length, 0);
  o.dups = { sameName_sameAge: 0, sameName_diffAge: 0, diffName_sameAge: 0, diffName_diffAge: 0 }; o.dupSameAge = 0;
  o.dupOverlap = { groups: groups.length, crossPart: 0, withAdded: 0, withBlank: 0, sameAge: 0, blankAndAdded: 0, withDeleted: 0, deletedAndAdded: 0, liveOnly: 0, liveOnlySameName: 0 };
  for (const g of groups) {
    const sameAge = new Set(g.map((r) => r.age)).size === 1, sameName = new Set(g.map((r) => r.name)).size === 1;
    if (sameAge) o.dupSameAge++;
    o.dups[`${sameName ? "sameName" : "diffName"}_${sameAge ? "sameAge" : "diffAge"}`]++;
    const d = o.dupOverlap, added = g.some((r) => r.st === "added"), blank = g.some((r) => !r.g), del = g.some((r) => r.del);
    if (new Set(g.map((r) => r.part)).size > 1) d.crossPart++; if (added) d.withAdded++; if (blank) d.withBlank++; if (sameAge) d.sameAge++;
    if (blank && added) d.blankAndAdded++; if (del) d.withDeleted++; if (del && added) d.deletedAndAdded++;
    if (!del) { d.liveOnly++; if (sameName) d.liveOnlySameName++; }
  }
  // additions
  o.addedByPart = o.perPart.map((p) => { const q = parts.get(p.part); return { part: p.part, n: p.e, added: q.added, modified: q.modified }; });
  const rates = o.addedByPart.filter((p) => p.n > 0).map((p) => p.added / p.n);
  o.addRate = { min: Math.min(...rates), p10: pctile(rates, 0.1), median: median(rates), p90: pctile(rates, 0.9), max: Math.max(...rates) };
  const secAdd = new Set(); for (const r of rows) if (r.st === "added") secAdd.add(`${r.part}|${r.sec}`); o.sectionsWithAdd = secAdd.size;
  const added = rows.filter((r) => r.st === "added");
  o.addedGender = { M: 0, F: 0, O: 0, "": 0 }; o.addedPyramid = { M: Array(8).fill(0), F: Array(8).fill(0) }; o.added18_29 = 0; o.addedAgeBad = 0; const addAges = [];
  for (const r of added) {
    o.addedGender[r.g in o.addedGender ? r.g : ""]++;
    const a = r.age; if (a == null || a < 18 || a > 120) { o.addedAgeBad++; continue; }
    addAges.push(a); if (a <= 29) o.added18_29++; if (r.g === "M" || r.g === "F") o.addedPyramid[r.g][band(a)]++;
  }
  o.addedMedianAge = median(addAges);
  // deleted (stamped) cards
  const dels = rows.filter((r) => r.del);
  const addedEpics = new Map(); for (const r of added) if (r.epic) (addedEpics.get(r.epic) || addedEpics.set(r.epic, []).get(r.epic)).push(r);
  o.deletedStats = { count: dels.length, blankGender: dels.filter((r) => !r.g).length, readded: 0, readdedSameAge: 0, readdedSamePart: 0, medianAge: median(dels.map((r) => r.age).filter((a) => a != null && a >= 18 && a <= 120)), perPart: o.perPart.map((p) => ({ part: p.part, cards: p.n, deleted: p.d })) };
  for (const r of dels) { const tw = addedEpics.get(r.epic); if (tw && tw.length) { o.deletedStats.readded++; if (tw.some((t) => t.age === r.age)) o.deletedStats.readdedSameAge++; if (tw.some((t) => t.part === r.part)) o.deletedStats.readdedSamePart++; } }
  const delRates = o.perPart.map((p) => p.n ? p.d / p.n : 0);
  o.deletedStats.rate = { median: median(delRates), p90: pctile(delRates, 0.9), max: Math.max(...delRates), partsWithNone: delRates.filter((x) => x === 0).length };
  return o;
}

function crossAc(all) {
  // all: { ac: rows[] }. EPIC numbers (current format) that occur in more than one constituency.
  const byEpic = new Map();
  for (const [ac, rows] of Object.entries(all)) for (const r of rows) if (epicClass(r.epic) === "modern") (byEpic.get(r.epic) || byEpic.set(r.epic, []).get(r.epic)).push({ ac, ...r });
  const groups = [...byEpic.values()].filter((g) => new Set(g.map((r) => r.ac)).size > 1);
  const o = { groups: groups.length, inAllThree: 0, pairs: {}, sameName: 0, sameNameSameAge: 0, diffNameSameAge: 0, diffNameDiffAge: 0, withDeleted: 0, withAdded: 0, deletedAndAdded: 0, bothLive: 0, bothLiveSameName: 0, bothLiveSameNameSameAge: 0, examplesKinds: {} };
  for (const g of groups) {
    const acs = [...new Set(g.map((r) => r.ac))].sort(); if (acs.length === 3) o.inAllThree++;
    const k = acs.join("-"); o.pairs[k] = (o.pairs[k] || 0) + 1;
    const sameName = new Set(g.map((r) => r.name)).size === 1, sameAge = new Set(g.map((r) => r.age)).size === 1;
    if (sameName) o.sameName++; if (sameName && sameAge) o.sameNameSameAge++; if (!sameName && sameAge) o.diffNameSameAge++; if (!sameName && !sameAge) o.diffNameDiffAge++;
    const del = g.some((r) => r.del), added = g.some((r) => r.st === "added");
    if (del) o.withDeleted++; if (added) o.withAdded++; if (del && added) o.deletedAndAdded++;
    const live = g.filter((r) => !r.del);
    if (new Set(live.map((r) => r.ac)).size > 1) { o.bothLive++; if (new Set(live.map((r) => r.name)).size === 1) { o.bothLiveSameName++; if (new Set(live.map((r) => r.age)).size === 1) o.bothLiveSameNameSameAge++; } }
  }
  // within-constituency: same EPIC, different names, both live (EPIC misread or reused), for comparison
  o.withinAcDiffNameLive = {};
  for (const [ac, rows] of Object.entries(all)) {
    const m = new Map(); for (const r of rows) if (!r.del && epicClass(r.epic) === "modern") (m.get(r.epic) || m.set(r.epic, []).get(r.epic)).push(r);
    let n = 0, sameAge = 0; for (const g of m.values()) if (g.length > 1 && new Set(g.map((r) => r.name)).size > 1) { n++; if (new Set(g.map((r) => r.age)).size === 1) sameAge++; }
    o.withinAcDiffNameLive[ac] = { groups: n, sameAge };
  }
  return o;
}

(async () => {
  const dry = process.argv.includes("--dry");
  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const c = new MongoClient(env.MONGO_URI, { socketTimeoutMS: 600000, maxPoolSize: 4 }); await c.connect();
  const db = c.db(env.MONGO_DB || "brahmastra"), v = db.collection("eroll_voters");
  const out = { acs: {}, district: {}, corpus: {}, runs: {}, press: prev.press, benchmark: prev.benchmark, translit: prev.translit, scaling: prev.scaling, stamp: prev.stamp, jewarRun: prev.jewarRun, builtAt: new Date().toISOString() };
  const all = {};
  for (const [ac, meta] of Object.entries(ACS)) {
    const key = `UTTARPRADESH::${ac}::2026::Final`;
    const parts = (await v.distinct("partNo", { key, source: "main" })).map(String).sort((a, b) => +a - +b);
    const rows = await fetchRows(v, key, parts);
    let deletedSource = "pipeline";
    if (!rows.some((r) => r.del)) { const j = joinScan(rows, meta.folder); if (j.applied) { deletedSource = "scan-join"; console.log(ac, "scan join:", JSON.stringify(j)); } else deletedSource = "none"; }
    const o = acStats(rows);
    o.name = meta.name; o.deletedSource = deletedSource; o.bytes = prev.acs?.[ac]?.bytes ?? null;
    o.untagged = await v.countDocuments({ key, source: null });
    const runFile = fs.existsSync(RUNS) ? fs.readdirSync(RUNS).find((f) => f.includes(`-${ac}-`) && f.endsWith(".summary.json")) : null;
    if (runFile) { const s = JSON.parse(fs.readFileSync(path.join(RUNS, runFile), "utf8")); out.runs[ac] = { started: s.startedAt, finished: s.finishedAt, durationMs: s.durationMs, pagesPerSec: s.pagesPerSec, pages: s.pages, rows: s.rows, flaggedRows: s.flaggedRows, flagCounts: s.flagCounts, duplicatesReplaced: s.duplicatesReplaced, pdfs: s.pdfs, failures: s.failures?.length ?? s.failures, warnings: Array.isArray(s.warnings) ? s.warnings.length : s.warnings }; if (s.pages) o.pages = s.pages; }
    out.acs[ac] = o; all[ac] = rows;
    console.log(ac, meta.name, "rows", o.rows, "deleted", o.deleted, "(" + deletedSource + ")", "electors", o.electors, "added", o.action.added, "sexRatio", o.sexRatio, "blank gender", o.gender[""], "dupEpics", o.dupEpics);
  }
  out.crossAc = crossAc(all);
  console.log("crossAc", JSON.stringify({ ...out.crossAc, examplesKinds: undefined }));
  const A = out.acs, sum = (f) => Object.values(A).reduce((s, a) => s + f(a), 0);
  out.district = { rows: sum((a) => a.rows), deleted: sum((a) => a.deleted), electors: sum((a) => a.electors), M: sum((a) => a.gender.M), F: sum((a) => a.gender.F), sexRatio: Math.round(1000 * sum((a) => a.gender.F) / sum((a) => a.gender.M)), added: sum((a) => a.action.added), modified: sum((a) => a.action.modified), age18_19: sum((a) => a.age18_19), parts: sum((a) => a.parts) };
  out.corpus = { pdfs: sum((a) => a.parts), pages: sum((a) => a.pages), bytes: prev.corpus?.bytes ?? null, gb: prev.corpus?.gb ?? null };
  await c.close();
  if (dry) { console.log("dry run, not written"); return; }
  fs.copyFileSync(OUT, OUT.replace(/\.json$/, `.prev.json`));
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("written", OUT);
})().catch((e) => { console.error(e); process.exit(1); });
