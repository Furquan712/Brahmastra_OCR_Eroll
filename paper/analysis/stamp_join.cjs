// Joins the stamp-scan outputs (one JSON line per card: page, idx, band, residBand, black) to the
// dashboard rows of the same roll and writes booth-level aggregates into ../data/gbn_stats.json
// under `stamp[<ac>]`. A card is joined by (part, page, position in reading order): the dashboard
// rows of a page sorted by serial number are the cards of that page in order.
// Usage: NODE_PATH=<dashboard node_modules> node stamp_join.cjs <scan_root> [--write]
//   <scan_root>/63-Jewar/*.jsonl, <scan_root>/61-Noida/*.jsonl, <scan_root>/62-Dadri/*.jsonl
const fs = require("node:fs"), path = require("node:path");
const { MongoClient } = require("mongodb");
const DASH = "/Volumes/External/algo/Brahmastra_Dashboard";
const BAND_MIN = 0.15, RESID_MIN = 0.04; // same thresholds as src/local.ts (STAMP_BAND_MIN, STAMP_RESID_BAND_MIN)
const t = fs.readFileSync(path.join(DASH, ".env"), "utf8");
const e = Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).replace(/\s*#.*$/, "").trim().replace(/^["']|["']$/g, "")]; }));
const root = process.argv[2]; const write = process.argv.includes("--write");
const FOLDERS = { 61: "61-Noida", 62: "62-Dadri", 63: "63-Jewar" };

function readScan(folder) {
  const byPart = new Map(); // part -> Map("page:idx" -> record)
  if (!fs.existsSync(folder)) return byPart;
  for (const f of fs.readdirSync(folder)) {
    const m = /-HIN-(\d+)-WI\.pdf\.jsonl$/.exec(f); if (!m) continue;
    const cards = new Map();
    for (const line of fs.readFileSync(path.join(folder, f), "utf8").split("\n")) {
      if (!line) continue; const x = JSON.parse(line);
      if (!("band" in x) || x.page <= 2 || !(x.black > 0.004 && x.black < 0.08)) continue; // text-bearing cards on card pages
      cards.set(`${x.page}:${x.idx}`, x);
    }
    byPart.set(m[1], cards);
  }
  return byPart;
}

(async () => {
  const c = new MongoClient(e.MONGO_URI); await c.connect();
  const v = c.db(e.MONGO_DB || "brahmastra").collection("eroll_voters");
  const st = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "gbn_stats.json"), "utf8"));
  st.stamp = st.stamp || {};
  for (const [ac, folder] of Object.entries(FOLDERS)) {
    const scan = readScan(path.join(root, folder));
    if (scan.size === 0) { console.log(ac, "no scan outputs"); continue; }
    const key = `UTTARPRADESH::${ac}::2026::Final`;
    const parts = [...scan.keys()];
    const rows = await v.find({ key, source: "main", partNo: { $in: parts } }, { projection: { partNo: 1, pageNo: 1, serialNo: 1, epicNo: 1, age: 1, gender: 1, actionStatus: 1, nameHi: 1 } }).toArray();
    // position of every row on its page
    const byPage = new Map();
    for (const r of rows) { const k = `${r.partNo}:${r.pageNo}`; (byPage.get(k) || byPage.set(k, []).get(k)).push(r); }
    let cards = 0, stamped = 0, joined = 0, stampedRows = [], pagesMismatch = 0;
    for (const [part, cardMap] of scan) {
      const pages = new Map();
      for (const x of cardMap.values()) (pages.get(x.page) || pages.set(x.page, []).get(x.page)).push(x);
      for (const [page, xs] of pages) {
        xs.sort((a, b) => a.idx - b.idx); cards += xs.length;
        const rs = (byPage.get(`${part}:${page}`) || []).sort((a, b) => a.serialNo - b.serialNo);
        if (rs.length !== xs.length) pagesMismatch++;
        for (let i = 0; i < xs.length; i++) {
          const x = xs[i]; const isStamped = x.band >= BAND_MIN && x.residBand >= RESID_MIN;
          if (isStamped) stamped++;
          if (rs.length === xs.length) { joined++; if (isStamped) stampedRows.push(rs[i]); }
        }
      }
    }
    // what the stamped rows look like in the dashboard, and whether the same EPIC was added elsewhere in the AC
    const epics = stampedRows.map((r) => r.epicNo).filter(Boolean);
    const twins = await v.find({ key, source: "main", epicNo: { $in: epics } }, { projection: { epicNo: 1, partNo: 1, actionStatus: 1, age: 1 } }).toArray();
    const twinByEpic = new Map();
    for (const r of twins) (twinByEpic.get(r.epicNo) || twinByEpic.set(r.epicNo, []).get(r.epicNo)).push(r);
    let readded = 0, readdedSameAge = 0, blankGender = 0, statusDeleted = 0, gender = { M: 0, F: 0, O: 0, "": 0 }, ages = [];
    for (const r of stampedRows) {
      if (!r.gender) blankGender++;
      gender[r.gender || ""] = (gender[r.gender || ""] || 0) + 1;
      if (r.actionStatus === "deleted") statusDeleted++;
      if (r.age > 0) ages.push(r.age);
      const others = (twinByEpic.get(r.epicNo) || []).filter((o) => String(o._id) !== String(r._id) && o.actionStatus === "added");
      if (r.epicNo && others.length) { readded++; if (others.some((o) => o.age === r.age)) readdedSameAge++; }
    }
    ages.sort((a, b) => a - b);
    const dupGroups = await v.aggregate([{ $match: { key, source: "main", epicNo: { $nin: [null, ""] } } }, { $group: { _id: "$epicNo", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "n" }]).toArray();
    const stampedEpicSet = new Set(epics);
    const dupWithStamp = await v.aggregate([{ $match: { key, source: "main", epicNo: { $in: epics } } }, { $group: { _id: "$epicNo", n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }, { $count: "n" }]).toArray();
    const out = {
      partsScanned: parts.length, cards, joined, stamped, stampedPct: +(100 * stamped / cards).toFixed(3), pagesMismatch,
      readded, readdedSameAge, blankGender, statusDeleted, gender, medianAge: ages[Math.floor(ages.length / 2)] || null,
      dupGroups: dupGroups[0]?.n || 0, dupGroupsWithStampedMember: dupWithStamp[0]?.n || 0,
      perPart: parts.map((p) => { const xs = [...scan.get(p).values()]; return { part: p, cards: xs.length, stamped: xs.filter((x) => x.band >= BAND_MIN && x.residBand >= RESID_MIN).length }; }),
    };
    st.stamp[ac] = out;
    const { perPart, ...short } = out; console.log(ac, JSON.stringify(short));
  }
  if (write) { fs.writeFileSync(path.join(__dirname, "..", "data", "gbn_stats.json"), JSON.stringify(st)); console.log("written"); }
  await c.close();
})().catch((err) => { console.error(err.message); process.exit(1); });
