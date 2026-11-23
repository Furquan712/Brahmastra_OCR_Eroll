// Measures (and with --write, applies to the dashboard) a repair of EPIC series prefixes misread by Tesseract:
// the 300-card benchmark showed Noida's ZYH series read as YHO/YHS and Dadri's NDT as NOT. A prefix is repaired
// when it holds < 0.5% of a constituency's current-format EPICs, is within one letter edit of a prefix holding
// > 2%, and the repaired number has seven digits (six-digit reads with a swallowed leading 0 are counted separately).
// Usage: NODE_PATH=<dashboard node_modules> node epic_series_repair.cjs [--write]
const fs = require("node:fs"), path = require("node:path"), { MongoClient } = require("mongodb");
const DASH = "/Volumes/External/algo/Brahmastra_Dashboard";
const env = Object.fromEntries(fs.readFileSync(path.join(DASH, ".env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).replace(/\s*#.*$/, "").trim().replace(/^["']|["']$/g, "")]; }));
const edit1 = (a, b) => { if (a === b) return false; if (a.length === b.length) return [...a].filter((ch, i) => ch !== b[i]).length === 1; const [s, l] = a.length < b.length ? [a, b] : [b, a]; if (l.length - s.length !== 1) return false; for (let i = 0; i <= s.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true; return false; };
(async () => {
  const write = process.argv.includes("--write");
  const c = new MongoClient(env.MONGO_URI); await c.connect(); const v = c.db(env.MONGO_DB || "brahmastra").collection("eroll_voters");
  const out = {};
  for (const ac of [61, 62, 63]) {
    const key = `UTTARPRADESH::${ac}::2026::Final`;
    const rows = await v.aggregate([{ $match: { key, source: "main", epicNo: { $regex: /^[A-Z]{3}[0-9]{6,7}$/ } } }, { $project: { p: { $substr: ["$epicNo", 0, 3] }, d: { $strLenCP: "$epicNo" } } }, { $group: { _id: { p: "$p", d: "$d" }, n: { $sum: 1 } } }]).toArray();
    const total = rows.reduce((s, r) => s + r.n, 0), byP = {};
    for (const r of rows) byP[r._id.p] = (byP[r._id.p] || 0) + r.n;
    const major = Object.entries(byP).filter(([, n]) => n / total > 0.02).map(([p]) => p);
    const plan = [];
    for (const [p, n] of Object.entries(byP)) if (n / total < 0.005) { const t = major.filter((m) => edit1(p, m)); if (t.length === 1) plan.push({ from: p, to: t[0], rows7: rows.filter((r) => r._id.p === p && r._id.d === 10).reduce((s, r) => s + r.n, 0), rows6: rows.filter((r) => r._id.p === p && r._id.d === 9).reduce((s, r) => s + r.n, 0) }); }
    out[ac] = { total, major: major.map((m) => `${m}:${byP[m]}`), plan: plan.filter((x) => x.rows7 + x.rows6 >= 20).sort((a, b) => b.rows7 - a.rows7) };
    console.log(ac, JSON.stringify(out[ac]));
    if (write) for (const x of out[ac].plan) { const r = await v.updateMany({ key, source: "main", epicNo: { $regex: new RegExp(`^${x.from}[0-9]{7}$`) } }, [{ $set: { epicNoRead: "$epicNo", epicNo: { $concat: [x.to, { $substr: ["$epicNo", 3, 7] }] } } }]); console.log("  repaired", x.from, "->", x.to, r.modifiedCount); }
  }
  fs.writeFileSync(path.join(__dirname, "epic_series_repair.json"), JSON.stringify(out, null, 1));
  await c.close();
})();
