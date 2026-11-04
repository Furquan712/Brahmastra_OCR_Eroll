#!/usr/bin/env node
/**
 * fill_part_names.cjs -- give unnamed dashboard parts their official ECI polling-station name
 * ===========================================================================================
 *
 * For every part that has voters in the dashboard (eroll_voters), looks at its eroll_parts doc.
 * If the doc is missing or its psNameEg is empty, sets psNameEg to the official English name from
 * the portal's part list (Brahmastra_OCR/data/parts/<STATE>-<AC>.json, written by eci_parts.py).
 * Parts that already have a name are never touched. Voter rows are never touched.
 *
 * Dry run by default (prints what it would change); writes only with --apply.
 *
 * Usage:
 *   NODE_PATH=/Volumes/External/algo/Brahmastra_Dashboard/node_modules node fill_part_names.cjs --state S24 --ac 61 62 63
 *   NODE_PATH=... node fill_part_names.cjs --state S24 --ac 61 62 63 --apply
 */
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient } = require("mongodb");

const DASH = process.env.DASHBOARD_DIR || "/Volumes/External/algo/Brahmastra_Dashboard";
const OCR = path.join(__dirname, "Brahmastra_OCR");
const STATE_NORM = { S24: "UTTARPRADESH", S10: "KARNATAKA", S01: "ANDHRAPRADESH", S13: "MAHARASHTRA", S05: "GOA" };

function env() {
  const t = fs.readFileSync(path.join(DASH, ".env"), "utf8");
  return Object.fromEntries(t.split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }));
}
function args() {
  const a = process.argv.slice(2), o = { ac: [], apply: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--apply") o.apply = true;
    else if (a[i] === "--state") o.state = a[++i].toUpperCase();
    else if (a[i] === "--ac") { while (a[i + 1] && /^\d+$/.test(a[i + 1])) o.ac.push(Number(a[++i])); }
    else throw new Error("unknown argument " + a[i]);
  }
  if (!o.state || !o.ac.length) {
    console.error("usage: --state S24 --ac 61 [62 ...] [--apply]");
    process.exit(2);
  }
  return o;
}

async function main() {
  const o = args();
  const stateNorm = STATE_NORM[o.state] || o.state;
  const e = env();
  const client = new MongoClient(e.MONGO_URI);
  await client.connect();
  const db = client.db(e.MONGO_DB);
  let total = 0;
  try {
    for (const ac of o.ac) {
      let official;
      try { official = JSON.parse(fs.readFileSync(path.join(OCR, "data", "parts", `${o.state}-${ac}.json`), "utf8")); }
      catch { console.error(`AC ${ac}: no official part list (run eci_parts.py first)`); continue; }
      const names = new Map(official.parts.filter((p) => p.partName).map((p) => [String(p.partNumber), p.partName.replace(/\s+/g, " ").trim()]));
      // One AC can hold several rolls (Draft / Final): handle each roll key on its own.
      const keys = await db.collection("eroll_voters").distinct("key", { stateNorm, acNo: ac });
      if (!keys.length) { console.log(`AC ${ac}: no voters in the dashboard - skipped`); continue; }
      for (const key of keys) {
        const voterParts = (await db.collection("eroll_voters").distinct("partNo", { key })).filter((p) => p !== "" && p != null);
        const docs = await db.collection("eroll_parts").find({ key }).project({ _id: 0, partNo: 1, psNameEg: 1 }).toArray();
        const byPart = new Map(docs.map((d) => [String(d.partNo), d]));
        const unnamed = [], noDoc = [], noOfficial = [];
        for (const partNo of voterParts) {
          const d = byPart.get(String(partNo));
          if (d && String(d.psNameEg || "").trim()) continue;
          const name = names.get(String(Number(partNo)));
          if (!name) { noOfficial.push(partNo); continue; }
          (d ? unnamed : noDoc).push({ partNo: String(partNo), name });
        }
        // Parts with a doc but no name, plus unnamed docs of parts with no voters.
        for (const d of docs) {
          if (voterParts.includes(d.partNo) || String(d.psNameEg || "").trim()) continue;
          const name = names.get(String(Number(d.partNo)));
          if (name) unnamed.push({ partNo: String(d.partNo), name });
        }
        const n = unnamed.length + noDoc.length;
        total += n;
        console.log(`AC ${ac} (${key}): ${voterParts.length} parts with voters | named already ${voterParts.length - noDoc.length - unnamed.length - noOfficial.length}` +
          ` | to fill ${n} (unnamed doc ${unnamed.length}, no part doc ${noDoc.length})${noOfficial.length ? ` | not in official list ${noOfficial.length} (${noOfficial.slice(0, 10).join(",")})` : ""}`);
        if (n) console.log("  e.g. " + [...unnamed, ...noDoc].slice(0, 3).map((p) => `${p.partNo}: ${p.name}`).join(" | "));
        if (!o.apply || !n) continue;
        const ops = [
          // The psNameEg condition keeps a name that was written in the meantime.
          ...unnamed.map((p) => ({ updateOne: { filter: { key, partNo: p.partNo, $or: [{ psNameEg: { $exists: false } }, { psNameEg: null }, { psNameEg: "" }] }, update: { $set: { psNameEg: p.name } } } })),
          ...noDoc.map((p) => ({ updateOne: { filter: { key, partNo: p.partNo }, update: { $setOnInsert: { key, stateNorm, acNo: ac, partNo: p.partNo, psNameEg: p.name } }, upsert: true } })),
        ];
        const r = await db.collection("eroll_parts").bulkWrite(ops, { ordered: false });
        console.log(`  applied: ${r.modifiedCount} named, ${r.upsertedCount} part docs created`);
      }
    }
  } finally {
    await client.close();
  }
  console.log(o.apply ? `done: ${total} part(s) filled` : `dry run: ${total} part(s) would be filled - pass --apply to write`);
}
main().catch((e) => { console.error(e); process.exit(2); });
