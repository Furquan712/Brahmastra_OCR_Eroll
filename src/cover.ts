/**
 * Cover page (page 1) of an eRoll PDF: tesseract text -> structured CoverInfo by regex. The PDF
 * file name (…-S24-62-SIR-FinalRoll-…-794-WI.pdf) fills gaps and cross-checks. Optionally the
 * same text is sent to a text model (OPENROUTER=true) whose AC / part / polling-station reads
 * take precedence when they are plausible. English fields are produced locally.
 */
import path from "node:path";
import sharp from "sharp";
import type { z } from "zod";
import { asciiDigits } from "./normalize.js";
import { COVER_JSON_SCHEMA, CoverZ } from "./schemas.js";
import type { Template } from "./templates.js";
import { tesseractBatch } from "./tesseract.js";
import type { Transliterator } from "./translit.js";
import type { CoverInfo } from "./types.js";

/** ECI state / UT codes as printed in file names and the roll title. */
export const STATE_CODES: Record<string, string> = {
  S01: "Andhra Pradesh", S02: "Arunachal Pradesh", S03: "Assam", S04: "Bihar", S05: "Goa", S06: "Gujarat",
  S07: "Haryana", S08: "Himachal Pradesh", S09: "Jammu and Kashmir", S10: "Karnataka", S11: "Kerala",
  S12: "Madhya Pradesh", S13: "Maharashtra", S14: "Manipur", S15: "Meghalaya", S16: "Mizoram", S17: "Nagaland",
  S18: "Odisha", S19: "Punjab", S20: "Rajasthan", S21: "Sikkim", S22: "Tamil Nadu", S23: "Tripura",
  S24: "Uttar Pradesh", S25: "West Bengal", S26: "Chhattisgarh", S27: "Jharkhand", S28: "Uttarakhand", S29: "Telangana",
  U01: "Andaman and Nicobar Islands", U02: "Chandigarh", U03: "Dadra and Nagar Haveli and Daman and Diu",
  U05: "NCT of Delhi", U06: "Lakshadweep", U07: "Puducherry", U08: "Jammu and Kashmir", U09: "Ladakh",
};

export const STATE_NAMES_HI: Record<string, string> = {
  "उत्तर प्रदेश": "Uttar Pradesh", "बिहार": "Bihar", "मध्य प्रदेश": "Madhya Pradesh", "राजस्थान": "Rajasthan",
  "छत्तीसगढ़": "Chhattisgarh", "छत्तीसगढ": "Chhattisgarh", "झारखंड": "Jharkhand", "झारखण्ड": "Jharkhand",
  "उत्तराखंड": "Uttarakhand", "उत्तराखण्ड": "Uttarakhand", "हरियाणा": "Haryana", "दिल्ली": "NCT of Delhi",
  "हिमाचल प्रदेश": "Himachal Pradesh", "महाराष्ट्र": "Maharashtra", "गुजरात": "Gujarat", "पंजाब": "Punjab",
  "चंडीगढ़": "Chandigarh", "जम्मू और कश्मीर": "Jammu and Kashmir", "लद्दाख": "Ladakh", "गोवा": "Goa",
  "पश्चिम बंगाल": "West Bengal", "असम": "Assam", "ओडिशा": "Odisha", "कर्नाटक": "Karnataka", "तेलंगाना": "Telangana",
};

export interface ErollFilenameInfo {
  year: string;
  stateCode: string;
  acNo: string;
  type: "Draft" | "Final" | "Unknown";
  partNo: string;
}

/** e.g. 2026-EROLLGEN-S24-62-SIR-FinalRoll-Revision1-HIN-794-WI.pdf */
export function parseErollFilename(file: string): ErollFilenameInfo | null {
  const base = path.basename(file).replace(/\.pdf$/i, "");
  const m = /^(\d{4})-EROLLGEN-([SU]\d{2})-(\d{1,3})-(.*)$/i.exec(base);
  if (!m) return null;
  const rest = m[4];
  const type: ErollFilenameInfo["type"] = /final/i.test(rest) ? "Final" : /draft/i.test(rest) ? "Draft" : "Unknown";
  const part = /-(\d{1,4})-[A-Z]{1,3}$/i.exec(rest) ?? /-(\d{1,4})$/.exec(rest);
  return { year: m[1], stateCode: m[2].toUpperCase(), acNo: String(Number(m[3])), type, partNo: part ? part[1] : "" };
}

export interface CoverParse {
  fields: Partial<Record<keyof CoverInfo, string>>;
  missing: string[];
}

const DATE_RE = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/;

/** Deterministic parse of the tesseract text of a cover page. All values are strings ("" = absent). */
export function parseCoverText(text: string): CoverParse {
  const lines = asciiDigits(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const all = lines.join("\n");
  const f: CoverParse["fields"] = {};

  // Title: "निर्वाचक नामावली 2026 S24 उत्तर प्रदेश" (S is often read as $ or 5)
  const title = lines.find((l) => /निर्वाचक\s*नामावली/.test(l) && /\d{4}/.test(l) && !/विधानसभा|भाग/.test(l));
  if (title) {
    const code = /(?:^|\s)[S$5]\s?(\d{2})(?=\s|$)/.exec(title);
    if (code) {
      f.stateEn = STATE_CODES[`S${code[1]}`] ?? "";
      const after = title.slice(code.index + code[0].length).trim();
      if (/[ऀ-ॿ]/.test(after)) f.stateHi = after.replace(/[^ऀ-ॿ\s]/g, "").trim();
    }
    const y = /\b((?:19|20)\d{2})\b/.exec(title);
    if (y) f.revisionYear = y[1];
  }
  if (!f.stateHi) {
    const hit = Object.keys(STATE_NAMES_HI).find((k) => all.includes(k));
    if (hit) f.stateHi = hit;
  }
  if (!f.stateEn && f.stateHi) f.stateEn = STATE_NAMES_HI[f.stateHi] ?? "";

  // AC: "विधानसभा निर्वाचन क्षेत्र की संख्या व नाम और आरक्षण स्थिति : 62 - दादरी (सामान्य) भाग संख्या : : 794"
  const acLine = lines.find((l) => /विधानसभा/.test(l) && !/^संसदीय/.test(l) && /:\s*\d{1,3}\s*[-–]/.test(l));
  if (acLine) {
    const m = /:\s*(\d{1,3})\s*[-–]\s*([^()]+?)\s*(?:\([^)]*\))?\s*(?:भाग.*)?$/.exec(acLine);
    if (m) {
      f.acNo = String(Number(m[1]));
      f.acNameHi = m[2].replace(/[^ऀ-ॿ\s.]/g, "").replace(/\s+/g, " ").trim();
    }
  }

  const part = /भाग\s*संख्या\s*[:：\s]*(\d{1,4})/.exec(all);
  if (part) f.partNo = String(Number(part[1]));

  const ry = /पुनरीक्षण\s*का\s*वर्ष\s*[:：]?\s*((?:19|20)\d{2})/.exec(all);
  if (ry) f.revisionYear = ry[1];

  // Roll identity line decides Draft/Final (the electors table also says "अंतिम क्रम", so look at नामावली lines only).
  const identity = lines.filter((l) => /नामावली/.test(l) && !/निर्वाचक\s*नामावली\s*\d{4}/.test(l));
  if (identity.some((l) => /अंतिम|अन्तिम|final/i.test(l))) f.revisionType = "Final";
  else if (identity.some((l) => /प्रारूप|draft/i.test(l))) f.revisionType = "Draft";

  for (const l of lines) {
    if (!/तिथि|दिनांक/.test(l)) continue;
    const d = DATE_RE.exec(l);
    if (!d) continue;
    if (/प्रकाशन/.test(l)) f.publicationDate ??= d[1];
    else f.qualifyingDate ??= d[1];
  }

  // Polling station "<no> - <name>" value line: prefer the one carrying the part number.
  const psIdx = lines.findIndex((l) => /मतदान\s*स्थल/.test(l));
  const valueLines = lines
    .map((l, i) => ({ i, m: /^(\d{1,4})\s*[-–]\s*(.+)$/.exec(l) }))
    .filter((x): x is { i: number; m: RegExpExecArray } => !!x.m && !/विधानसभा|संसदीय/.test(lines[x.i]));
  const ps = (f.partNo && valueLines.find((v) => String(Number(v.m[1])) === f.partNo)) || (psIdx >= 0 && valueLines.find((v) => v.i > psIdx)) || null;
  if (ps) {
    const name = ps.m[2].replace(/\s*इस\s+भाग.*$/, "").replace(/[|_]+/g, " ").replace(/\s+[^ऀ-ॿ\d.]{1,2}$/u, "").replace(/\s+/g, " ").trim();
    f.psNameHi = name;
    f.psNoAndNameHi = `${String(Number(ps.m[1]))} - ${name}`;
  }

  const addrIdx = lines.findIndex((l) => /मतदान\s*स्थल\s*का\s*पता/.test(l));
  if (addrIdx >= 0) {
    for (let i = addrIdx; i < Math.min(lines.length, addrIdx + 4); i++) {
      const l = i === addrIdx ? lines[i].replace(/^.*पता\s*[:：]?\s*/, "") : lines[i];
      if (/[ऀ-ॿ]{3,}/.test(l) && !/निर्वाचकों|संख्या\s*[:：]\s*$|^\d+\./.test(l)) {
        f.psAddressHi = l.trim();
        break;
      }
    }
  }

  // Electors table: the numeric row "1 350 181 169 0 350" -> first serial, last serial, ..., total.
  const elIdx = lines.findIndex((l) => /निर्वाचकों\s*की\s*संख्या/.test(l));
  if (elIdx >= 0) {
    for (let i = elIdx + 1; i < Math.min(lines.length, elIdx + 8); i++) {
      const nums = lines[i].replace(/[^\d]+/g, " ").trim().split(" ").filter(Boolean).map(Number);
      if (nums.length >= 3 && nums.every((n) => n < 100000)) {
        f.serialFrom = String(nums[0]);
        f.serialTo = String(nums[1]);
        f.totalElectors = String(nums[nums.length - 1]);
        break;
      }
    }
  }

  const want: (keyof CoverInfo)[] = ["stateHi", "acNo", "acNameHi", "partNo", "revisionYear", "revisionType", "psNameHi", "serialTo"];
  return { fields: f, missing: want.filter((k) => !f[k]) };
}

export async function readCoverText(pngPath: string, tpl: Template, workDir: string): Promise<string> {
  // Page-segmentation mode 4 (single column of variable-size text) reads the two-column cover far
  // better than mode 6, and English first keeps the digits intact.
  const png = await sharp(pngPath).greyscale().png().toBuffer();
  const [r] = await tesseractBatch([png], { langs: tpl.local.langs, psm: tpl.local.coverPsm ?? 4 }, workDir);
  return r?.text ?? "";
}

export function coverPrompt(text: string): string {
  return `Below is OCR text (Hindi, Devanagari; some characters garbled) of the cover page of an Indian electoral roll (ECI eRoll). Extract the fields as JSON. Copy values exactly as printed; use "" when a field is absent. Digits only for acNo, partNo, serialFrom, serialTo, totalElectors, revisionYear.

- stateHi / stateEn: state name as printed and its standard English name.
- acNo, acNameHi: the ASSEMBLY constituency (विधानसभा निर्वाचन क्षेत्र) number and name - NOT the parliamentary (संसदीय) one. Name without the reservation note in brackets.
- acNameEn: "" (filled locally).
- partNo: भाग संख्या.
- psNoAndNameHi / psNameHi / psNameEn / psAddressHi: polling station (मतदान स्थल) number and name as printed, the name alone, "" for psNameEn, and the address.
- revisionType: "Final" if the roll identity line says अंतिम/final, "Draft" for प्रारूप/draft, else "Unknown".
- revisionYear, qualifyingDate (अर्हता तिथि), publicationDate (प्रकाशन की तिथि).
- serialFrom / serialTo / totalElectors from the निर्वाचकों की संख्या table.
- present: true.

OCR text:
"""
${text.slice(0, 6000)}
"""`;
}

export type CoverModelOut = z.infer<typeof CoverZ>;
export const COVER_SCHEMA = COVER_JSON_SCHEMA;
export const CoverModelZ = CoverZ;

const digits = (s: string | undefined): string => (s ?? "").replace(/\D/g, "");
const num = (s: string | undefined): number | null => (s && /\d/.test(s) ? Number(digits(s)) : null);

/**
 * Combines regex fields, optional model fields and file-name info into a CoverInfo plus
 * warnings. Precedence: model (when plausible) > regex > file name; English via the transliterator.
 */
export function buildCover(
  regex: CoverParse, model: CoverModelOut | null, fn: ErollFilenameInfo | null, translit: Transliterator, pdfLabel: string,
): { cover: CoverInfo; warnings: string[] } {
  const w: string[] = [];
  const r = regex.fields;
  const pick = (k: keyof CoverInfo, numeric = false): string => {
    const m = model ? String((model as Record<string, unknown>)[k] ?? "").trim() : "";
    const mv = numeric ? digits(m) : m;
    const rv = numeric ? digits(r[k] ?? "") : (r[k] ?? "");
    if (mv && rv && mv !== rv) w.push(`${pdfLabel}: cover ${k}: model "${mv}" != text "${rv}" (model kept)`);
    return mv || rv;
  };
  let acNo = pick("acNo", true);
  let partNo = pick("partNo", true);
  let revisionYear = pick("revisionYear", true).slice(0, 4);
  let stateEn = r.stateEn ?? "";
  if (!stateEn && model?.stateEn) stateEn = model.stateEn;
  const typeRaw = pick("revisionType");
  let revisionType: CoverInfo["revisionType"] = typeRaw === "Final" || typeRaw === "Draft" ? typeRaw : "Unknown";

  if (fn) {
    if (!acNo) acNo = fn.acNo;
    else if (fn.acNo && acNo !== fn.acNo) w.push(`${pdfLabel}: cover AC no ${acNo} != file name AC no ${fn.acNo}`);
    if (!partNo) partNo = fn.partNo;
    else if (fn.partNo && partNo !== fn.partNo) w.push(`${pdfLabel}: cover part no ${partNo} != file name part no ${fn.partNo}`);
    if (!revisionYear) revisionYear = fn.year;
    if (revisionType === "Unknown") revisionType = fn.type;
    else if (fn.type !== "Unknown" && fn.type !== revisionType) w.push(`${pdfLabel}: cover says ${revisionType} but file name says ${fn.type}`);
    if (!stateEn) stateEn = STATE_CODES[fn.stateCode] ?? "";
  }
  const stateHi = pick("stateHi");
  const acNameHi = pick("acNameHi");
  const psNameHi = pick("psNameHi");
  const psNoAndNameHi = pick("psNoAndNameHi") || (psNameHi && partNo ? `${partNo} - ${psNameHi}` : "");
  for (const k of regex.missing) if (!(model && String((model as Record<string, unknown>)[k] ?? "").trim())) w.push(`${pdfLabel}: cover field ${k} not read`);

  const cover: CoverInfo = {
    stateHi, stateEn,
    acNo, acNameHi, acNameEn: acNameHi ? translit.name(acNameHi) : "",
    partNo,
    psNoAndNameHi, psNameHi, psNameEn: psNameHi ? translit.name(psNameHi) : "", psAddressHi: pick("psAddressHi"),
    revisionType, revisionYear,
    qualifyingDate: pick("qualifyingDate"), publicationDate: pick("publicationDate"),
    serialFrom: num(pick("serialFrom", true)), serialTo: num(pick("serialTo", true)), totalElectors: num(pick("totalElectors", true)),
  };
  return { cover, warnings: w };
}
