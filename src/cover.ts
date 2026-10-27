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
import { tesseractBatch, type TessResult } from "./tesseract.js";
import type { Transliterator } from "./translit.js";
import type { CoverInfo, SectionEntry } from "./types.js";

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
  /** "2" for 2026-SUPPLEMENTGEN-S05-26-2-...-ENG-17-WI.pdf (supplement 2 of part 17); "" for a roll. */
  supplementNo: string;
}

/**
 * ECI download names: 2026-EROLLGEN-S24-62-SIR-FinalRoll-Revision1-HIN-794-WI.pdf (roll),
 * 2026-SUPPLEMENTGEN-S05-26-2-all_together-ENG-17-WI.pdf (supplement 2, part 17), and the
 * bulk-download form AC026_SIR-FinalRoll_part_0001.pdf.
 */
export function parseErollFilename(file: string): ErollFilenameInfo | null {
  const base = path.basename(file).replace(/\.pdf$/i, "");
  let m = /^(\d{4})-(EROLLGEN|SUPPLEMENTGEN)-([SU]\d{2})-(\d{1,3})-(.*)$/i.exec(base);
  if (m) {
    const rest = m[5];
    const supplement = m[2].toUpperCase() === "SUPPLEMENTGEN";
    const type: ErollFilenameInfo["type"] = /final/i.test(rest) ? "Final" : /draft/i.test(rest) ? "Draft" : "Unknown";
    const part = /-(\d{1,4})-[A-Z]{1,3}$/i.exec(rest) ?? /-(\d{1,4})$/.exec(rest);
    const supp = supplement ? /^(\d{1,2})(?:-|$)/.exec(rest) : null;
    return { year: m[1], stateCode: m[3].toUpperCase(), acNo: String(Number(m[4])), type, partNo: part ? part[1] : "", supplementNo: supp ? String(Number(supp[1])) : "" };
  }
  m = /^AC(\d{1,3})[_-](.*?)part[_-]?(\d{1,4})$/i.exec(base);
  if (m) {
    const type: ErollFilenameInfo["type"] = /final/i.test(m[2]) ? "Final" : /draft/i.test(m[2]) ? "Draft" : "Unknown";
    return { year: "", stateCode: "", acNo: String(Number(m[1])), type, partNo: String(Number(m[3])), supplementNo: "" };
  }
  return null;
}

export interface CoverParse {
  fields: Partial<Record<keyof CoverInfo, string>>;
  /** The cover's list of sections in the part, when read. */
  sections?: { no: string; name: string }[];
  missing: string[];
}

/** True when a page's text is a roll cover (page 1 of a separately published supplement is not). */
export function looksLikeCover(text: string): boolean {
  return /(?:निर्वाचक\s*नामावली|ELECTORAL\s+ROLL)/i.test(text) && /(?:पुनरीक्षण\s*का\s*विवरण|मतदान\s*स्थल|Details\s+of\s+Revision|Polling\s+station)/i.test(text);
}

/**
 * Header of a separately published supplement ("Supplement 2 / ... / Assembly Constituency No and
 * Name : 26-DABOLIM / Part No. : 17", or the Hindi equivalent): the few identifiers such a PDF has.
 */
export function parseSupplementHeader(text: string): Partial<Record<keyof CoverInfo, string>> {
  const t = asciiDigits(text).replace(/\s+/g, " ").trim();
  const f: Partial<Record<keyof CoverInfo, string>> = {};
  const sup = /(?:Supplement|Supplementary\s+(?:list|roll)|अनुपूरक|परिशिष्ट|पूरक\s*सूची)\s*(?:No\.?|संख्या)?\s*[:：-]?\s*(\d{1,2})\b/i.exec(t);
  if (sup) f.supplementNo = String(Number(sup[1]));
  const ac = /(?:Assembly\s+Constituency(?:\s*No\.?\s*(?:and|&)\s*Name)?|विधानसभा\s*निर्वाचन\s*क्षेत्र)\s*[:：\s]*(\d{1,3})\s*[-–]\s*(.+?)(?=\s*(?:\(|Part\s*No|भाग\s*संख्या|$))/i.exec(t);
  if (ac) {
    f.acNo = String(Number(ac[1]));
    f.acNameHi = cleanMetaValue(ac[2]);
  }
  const part = /(?:Part\s*No\.?|भाग\s*संख्या)\s*[:：\s]*(\d{1,4})/i.exec(t);
  if (part) f.partNo = String(Number(part[1]));
  const y = /\b((?:19|20)\d{2})\b/.exec(t);
  if (y) f.revisionYear = y[1];
  return f;
}

/** "1-Near Sohia Pay Phone, New Vaddem" lines (a wrapped name continues on the next line). */
export function parseSectionList(text: string): { no: string; name: string }[] {
  const out: { no: string; name: string }[] = [];
  for (const raw of asciiDigits(text).split(/\r?\n/)) {
    const l = raw.replace(/\s+/g, " ").trim();
    if (!l) continue;
    const m = /^(\d{1,3})\s*[-–.:]\s*(.+)$/.exec(l);
    if (m) out.push({ no: String(Number(m[1])), name: cleanMetaValue(m[2]) });
    // A wrapped name continues on a short line of its own; a line carrying a label (":") is the
    // right-hand box of a whole-page read, not a section.
    else if (out.length && /[ऀ-ॿA-Za-z]{2,}/.test(l) && !/[:：]/.test(l) && l.split(" ").length <= 4) {
      out[out.length - 1].name = cleanMetaValue(out[out.length - 1].name + " " + l);
    }
  }
  return out.filter((e) => e.name);
}

/** Values of a Latin-script roll are printed in CAPITALS here and there; "SOUTH GOA" -> "South Goa". */
export function titleCaseIfUpper(v: string): string {
  if (!/[A-Z]/.test(v) || /[a-z]/.test(v)) return v;
  return v.toLowerCase().replace(/(^|[\s\-(/.])([a-z])/g, (m, pre: string, ch: string) => pre + ch.toUpperCase());
}

const DATE_RE = /(\d{1,2}[-/.]\d{1,2}[-/.]\d{4})/;

/**
 * Labelled fields of cover section 2 ("भाग और मतदान क्षेत्र का विवरण"). The label may be preceded by
 * junk from the left column (section names) when the whole page is read, so it is not anchored.
 */
const META_LABELS: { key: keyof CoverInfo; re: RegExp }[] = [
  { key: "mainTownVillageHi", re: /कस्?बा\s*(?:अथवा|या)?\s*(?:ग्राम|गाँव|गांव)?\s*[:：]\s*(.*)$/ },
  { key: "wardHi", re: /(?:^|\s)वार्ड\s*[:：]\s*(.*)$/ },
  { key: "postOfficeHi", re: /(?:^|\s)(?:डाकघर|डाक\s*घर|पोस्ट\s*ऑफिस)\s*[:：>]\s*(.*)$/ },
  { key: "policeStationHi", re: /(?:^|\s)(?:थाना|पुलिस\s*स्टेशन)\s*[:：]\s*(.*)$/ },
  { key: "panchayatHi", re: /(?:^|\s)पंचायत\s*[:：]?\s*(.*)$/ },
  { key: "blockHi", re: /(?:^|\s)(?:ब्लॉक|ब्लाक|ब्लौक|विकास\s*खंड|विकासखण्ड|विकास\s*खण्ड)\s*[:：]?\s*(.*)$/ },
  { key: "tehsilHi", re: /(?:^|\s)(?:तहसील|तहसिल)\s*[:：]\s*(.*)$/ },
  { key: "districtHi", re: /(?:^|\s)(?:जिला|ज़िला|जिल्ला)\s*[:：]\s*(.*)$/ },
  { key: "pinCode", re: /(?:^|\s)(?:पिन\s*कोड|पिनकोड|पिन)\s*[:：]?\s*(\d[\d\s]{3,9}\d)\s*$/ },
  // English rolls (Goa, ...): "Main Town or Village : VASCO-DA-GAMA", "Subdivision : MORMUGAO" (= tehsil).
  { key: "mainTownVillageHi", re: /(?:^|\s)Main\s*Town\s*(?:or|\/|and)?\s*Village\s*[:：]\s*(.*)$/i },
  { key: "wardHi", re: /(?:^|\s)Ward\s*(?:No\.?|Name)?\s*[:：]\s*(.*)$/i },
  { key: "postOfficeHi", re: /(?:^|\s)Post\s*Office\s*[:：]\s*(.*)$/i },
  { key: "policeStationHi", re: /(?:^|\s)Police\s*Station\s*[:：]\s*(.*)$/i },
  { key: "panchayatHi", re: /(?:^|\s)(?:Gram\s*)?Panchayat\s*[:：]?\s*(.*)$/i },
  { key: "blockHi", re: /(?:^|\s)Block\s*[:：]?\s*(.*)$/i },
  { key: "tehsilHi", re: /(?:^|\s)(?:Sub[\s-]*division|Tehsil|Tahsil|Taluka|Taluk|Mandal)\s*[:：]\s*(.*)$/i },
  { key: "districtHi", re: /(?:^|\s)District\s*[:：]\s*(.*)$/i },
  { key: "pinCode", re: /(?:^|\s)Pin\s*code\s*[:：]?\s*(\d[\d\s]{3,9}\d)\s*$/i },
];

/** Labels that may follow a value on the same line of a whole-page read; a value stops there. */
const NEXT_LABEL_SPLIT = /\s(?=(?:वार्ड|डाकघर|थाना|पंचायत|ब्लॉक|तहसील|जिला|पिन|Ward|Post\s*Office|Police\s*Station|Panchayat|Block|Sub[\s-]*division|Tehsil|District|Pin\s*code)\s*[:：])/i;

/** A value from a labelled cover line: Devanagari, digits and light punctuation only. */
export function cleanMetaValue(v: string): string {
  return asciiDigits(v)
    .replace(/[^ऀ-ॿ0-9A-Za-z\s.,()/-]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.,/-]+|[\s.,/-]+$/g, "")
    .trim();
}

/** Section-2 fields from the text of a cover page (or of the section-2 box alone). */
export function parseCoverMetaText(text: string): Partial<Record<keyof CoverInfo, string>> {
  const lines = asciiDigits(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const f: Partial<Record<keyof CoverInfo, string>> = {};
  for (const l of lines) {
    for (const { key, re } of META_LABELS) {
      if (f[key] !== undefined) continue;
      const m = re.exec(l);
      if (!m) continue;
      if (key === "pinCode") {
        const d = m[1].replace(/\D/g, "");
        if (d.length === 6) f.pinCode = d;
        continue;
      }
      // An empty value ("पंचायत :") is legitimate; stop at the next label on the same line.
      const v = cleanMetaValue(m[1].split(NEXT_LABEL_SPLIT)[0]);
      f[key] = /[ऀ-ॿA-Za-z]/.test(v) ? v : "";
      break;
    }
  }
  return f;
}

/** Deterministic parse of the tesseract text of a cover page. All values are strings ("" = absent). */
export function parseCoverText(text: string): CoverParse {
  const lines = asciiDigits(text).split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const all = lines.join("\n");
  const f: CoverParse["fields"] = {};

  // Title: "निर्वाचक नामावली 2026 S24 उत्तर प्रदेश" / "ELECTORAL ROLL 2026 S05 Goa" (S is often read as $ or 5)
  const title = lines.find((l) => /निर्वाचक\s*नामावली|ELECTORAL\s+ROLL/i.test(l) && /\d{4}/.test(l) && !/विधानसभा|भाग|Assembly|Part/i.test(l));
  if (title) {
    const code = /(?:^|\s)[S$5]\s?(\d{2})(?=\s|$)/.exec(title);
    if (code) {
      f.stateEn = STATE_CODES[`S${code[1]}`] ?? "";
      const after = title.slice(code.index + code[0].length).trim();
      if (/[ऀ-ॿ]/.test(after)) f.stateHi = after.replace(/[^ऀ-ॿ\s]/g, "").trim();
      else if (!f.stateEn && /[A-Za-z]/.test(after)) f.stateEn = after.replace(/[^A-Za-z\s]/g, "").trim();
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
  //     "No. Name and Reservation Status of Assembly Constituency : 26 - DABOLIM (GEN) Part No.:1"
  const acLine = lines.find((l) =>
    ((/विधानसभा/.test(l) && !/^संसदीय/.test(l)) || (/Assembly\s+Constituency/i.test(l) && !/Parliamentary/i.test(l))) && /:\s*\d{1,3}\s*[-–]/.test(l),
  );
  if (acLine) {
    const m = /:\s*(\d{1,3})\s*[-–]\s*([^()]+?)\s*(?:\([^)]*\))?\s*(?:भाग.*|Part.*)?$/i.exec(acLine);
    if (m) {
      f.acNo = String(Number(m[1]));
      f.acNameHi = m[2].replace(/[^ऀ-ॿA-Za-z\s.\-]/g, "").replace(/\s+/g, " ").trim();
    }
  }

  const part = /(?:भाग\s*संख्या|Part\s*No\.?)\s*[:：\s]*(\d{1,4})/i.exec(all);
  if (part) f.partNo = String(Number(part[1]));

  const ry = /(?:पुनरीक्षण\s*का\s*वर्ष|Year\s+of\s+Revision)\s*[:：]?\s*((?:19|20)\d{2})/i.exec(all);
  if (ry) f.revisionYear = ry[1];

  // Roll identity decides Draft/Final: the नामावली lines (the electors table also says "अंतिम क्रम",
  // so the title line is excluded), or the lines under "Roll Identification".
  const identity = lines.filter((l) => /नामावली/.test(l) && !/निर्वाचक\s*नामावली\s*\d{4}/.test(l));
  const idIdx = lines.findIndex((l) => /Roll\s+Identification/i.test(l));
  if (idIdx >= 0) identity.push(...lines.slice(idIdx, idIdx + 5));
  if (identity.some((l) => /अंतिम|अन्तिम|final|integrated/i.test(l))) f.revisionType = "Final";
  else if (identity.some((l) => /प्रारूप|draft/i.test(l))) f.revisionType = "Draft";

  for (const l of lines) {
    if (!/तिथि|दिनांक|Date/i.test(l)) continue;
    const d = DATE_RE.exec(l);
    if (!d) continue;
    if (/प्रकाशन|Publication|Updation/i.test(l)) f.publicationDate ??= d[1];
    else if (/अर्हता|तिथि|दिनांक|Qualifying/i.test(l)) f.qualifyingDate ??= d[1];
  }

  // Polling station "<no> - <name>": the value line after the station label (the cover's section
  // list is printed the same way, so lines before the label are never taken), preferring the one
  // that carries the part number.
  const psIdx = lines.findIndex((l) => /मतदान\s*स्थल/.test(l) || /Name\s+of\s+Polling\s+Station/i.test(l));
  const valueLines = lines
    .map((l, i) => ({ i, m: /^(\d{1,4})\s*[-–]\s*(.+)$/.exec(l) }))
    .filter((x): x is { i: number; m: RegExpExecArray } => !!x.m && !/विधानसभा|संसदीय|Assembly|Parliamentary/i.test(lines[x.i]));
  const afterLabel = psIdx >= 0 ? valueLines.filter((v) => v.i > psIdx) : valueLines;
  const ps = (f.partNo && afterLabel.find((v) => String(Number(v.m[1])) === f.partNo)) || afterLabel[0] || null;
  if (ps) {
    let name = ps.m[2];
    // A wrapped station name ("..., New Vaddem," / "... (Room") continues on the next line, where
    // right-column text may trail it.
    if ((/,\s*$/.test(name) || (name.split("(").length > name.split(")").length)) && lines[ps.i + 1]) name += " " + lines[ps.i + 1];
    name = name
      .replace(/\s*(?:इस\s+भाग|Number\s+of\s+Auxiliary|Type\s+of\s+Polling).*$/i, "")
      .replace(/[|_]+/g, " ")
      .replace(/\s+[^ऀ-ॿA-Za-z\d.)]{1,2}$/u, "")
      .replace(/\s+/g, " ")
      .trim();
    f.psNameHi = name;
    f.psNoAndNameHi = `${String(Number(ps.m[1]))} - ${name}`;
  }

  const addrIdx = lines.findIndex((l) => /मतदान\s*स्थल\s*का\s*पता/.test(l) || /Address\s+of\s+Polling\s+Station/i.test(l));
  if (addrIdx >= 0) {
    const parts: string[] = [];
    for (let i = addrIdx; i < Math.min(lines.length, addrIdx + 4); i++) {
      const l = i === addrIdx ? lines[i].replace(/^.*(?:पता|Station)\s*[:：]?\s*/i, "") : lines[i];
      if (!l) continue;
      if (/निर्वाचकों|NUMBER\s+OF\s+ELECTORS|^\d+\.|संख्या\s*[:：]\s*$/i.test(l)) break;
      if (/[ऀ-ॿ]{3,}|[A-Za-z]{3,}/.test(l)) parts.push(l.trim());
      if (parts.length && !/,\s*$/.test(l)) break; // a line that does not end in a comma ends the address
    }
    if (parts.length) f.psAddressHi = parts.join(" ").replace(/\s+/g, " ");
  }

  // Electors table: the numeric row "1 350 181 169 0 350" -> first serial, last serial, ..., total.
  const elIdx = lines.findIndex((l) => /निर्वाचकों\s*की\s*संख्या|NUMBER\s+OF\s+ELECTORS/i.test(l));
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

  // Section 2 (town/village, ward, post office, police station, ..., pin code) from the full text.
  // readCoverPage() re-reads that box alone at 2x, which is cleaner; those values win in buildCover.
  Object.assign(f, parseCoverMetaText(text));

  // The section list from the whole-page read: between its heading and the station details, with
  // whatever of the right-hand box ran into the same line cut off. The dedicated crop is cleaner.
  const secStart = lines.findIndex((l) => /अनुभागों\s*की\s*संख्या|name\s+of\s+sections/i.test(l));
  const secEnd = lines.findIndex((l, i) => i > secStart && /मतदान\s*स्थल\s*का\s*विवरण|Polling\s+station\s+details/i.test(l));
  const sections = secStart >= 0
    ? parseSectionList(lines.slice(secStart + 1, secEnd > secStart ? secEnd : secStart + 12).map((l) => l.split(/\s(?=(?:मुख्य|कस्बा|Main\s+Town)\b)/i)[0].split(NEXT_LABEL_SPLIT)[0]).join("\n"))
    : [];

  const want: (keyof CoverInfo)[] = ["stateHi", "acNo", "acNameHi", "partNo", "revisionYear", "revisionType", "psNameHi", "serialTo"];
  if (!/[ऀ-ॿ]/.test(all)) want.splice(want.indexOf("stateHi"), 1); // English roll: no Devanagari state name to miss
  return { fields: f, sections, missing: want.filter((k) => !f[k]) };
}

export async function readCoverText(pngPath: string, tpl: Template, workDir: string): Promise<string> {
  return (await readCoverPage(pngPath, tpl, workDir)).text;
}

export interface CoverRead {
  /** Whole-page tesseract text (psm 4). */
  text: string;
  /** Section-2 box ("मुख्य कस्बा ... पिन कोड") re-read on its own at 2x; "" when the box was not located. */
  metaText: string;
  /** Pin code from a digit-only re-read of the pin line; "" when not read. */
  pinCode: string;
  /** The "sections in the part" list (left of the box) re-read on its own at 2x; "" when not located. */
  sectionsText: string;
}

const META_LABEL_WORD = /^[:：]?(?:मुख्य|कस्बा|वार्ड|डाकघर|थाना|पंचायत|ब्लॉक|ब्लाक|तहसील|जिला|पिन|Main|Ward|Post|Police|Panchayat|Block|Sub-?division|Tehsil|Taluka|Mandal|District|Pin)[:：]?$/i;

/**
 * Cover page OCR. The two-column page is read as a whole (psm 4), then the section-2 box is
 * located from the positions of its label words and re-read alone, upscaled, so the section
 * names printed in the left column cannot run into the values. The pin code gets a digit-only
 * pass because the thin "1" of this print is dropped or read as "7" at native resolution.
 */
export async function readCoverPage(pngPath: string, tpl: Template, workDir: string): Promise<CoverRead> {
  // Page-segmentation mode 4 (single column of variable-size text) reads the two-column cover far
  // better than mode 6, and English first keeps the digits intact.
  const img = sharp(pngPath);
  const meta = await img.metadata();
  const W = meta.width ?? 0, H = meta.height ?? 0;
  const png = await img.clone().greyscale().png().toBuffer();
  const [r] = await tesseractBatch([png], { langs: tpl.local.langs, psm: tpl.local.coverPsm ?? 4 }, workDir);
  const out: CoverRead = { text: r?.text ?? "", metaText: "", pinCode: "", sectionsText: "" };
  if (!r || !W || !H) return out;

  // Locate the box: label words share one left edge (x) in the right half of the page.
  let labels = r.words.filter((w) => META_LABEL_WORD.test(w.text) && w.x > W * 0.3);
  if (labels.length >= 3) {
    const xs = labels.map((w) => w.x).sort((a, b) => a - b);
    const med = xs[Math.floor(xs.length / 2)];
    labels = labels.filter((w) => Math.abs(w.x - med) < W * 0.03);
  }
  if (labels.length < 3) return out;
  const top = Math.max(0, Math.min(...labels.map((w) => w.y)) - Math.round(H * 0.012));
  const bottom = Math.min(H, Math.max(...labels.map((w) => w.y + w.h)) + Math.round(H * 0.012));
  const left = Math.max(0, Math.min(...labels.map((w) => w.x)) - Math.round(W * 0.015));
  const right = W - Math.round(W * 0.012);
  if (bottom - top < 20 || right - left < 50) return out;
  const box = { left, top, width: right - left, height: bottom - top };

  // The section list sits left of the box, under its heading ("भाग में अनुभागों की संख्या और नाम" /
  // "No. and name of sections in the part") and above the station details.
  const heading = r.words.filter((w) => /^(?:अनुभागों|sections)$/i.test(w.text) && w.x < W * 0.5 && w.y < top + (bottom - top));
  if (heading.length) {
    const sTop = Math.max(...heading.map((w) => w.y + w.h)) + Math.round(H * 0.004);
    const stop = r.words.filter((w) => /^(?:मतदान|Polling)$/i.test(w.text) && w.y > sTop && w.x < W * 0.3).map((w) => w.y);
    const sBottom = Math.min(stop.length ? Math.min(...stop) - Math.round(H * 0.004) : bottom, bottom + Math.round(H * 0.05), H);
    const sLeft = Math.round(W * 0.012), sRight = Math.max(sLeft + 50, left - Math.round(W * 0.01));
    if (sBottom - sTop > 15) {
      const sBox = { left: sLeft, top: sTop, width: sRight - sLeft, height: sBottom - sTop };
      const sCrop = await img.clone().extract(sBox).resize({ width: sBox.width * 2, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer();
      const [sr] = await tesseractBatch([sCrop], { langs: tpl.local.langs, psm: 6 }, workDir);
      out.sectionsText = sr?.text ?? "";
    }
  }
  const crop = await img.clone().extract(box).resize({ width: box.width * 2, kernel: "lanczos3" }).greyscale().normalise().png().toBuffer();
  const [m] = await tesseractBatch([crop], { langs: tpl.local.langs, psm: 6 }, workDir);
  if (!m) return out;
  out.metaText = m.text;

  // Pin code: digit-only re-read of the number on the "पिन कोड" line.
  const pinLine = m.lines.find((l) => /पिन/.test(l.text));
  const digitsWord = pinLine?.words.filter((w) => /\d/.test(asciiDigits(w.text))).sort((a, b) => b.w - a.w)[0];
  if (digitsWord) {
    const cm = await sharp(crop).metadata();
    const cw = cm.width ?? 0, ch = cm.height ?? 0;
    const l2 = Math.max(0, digitsWord.x - 20), t2 = Math.max(0, digitsWord.y - 14);
    const w2 = Math.min(cw - l2, digitsWord.w + 60), h2 = Math.min(ch - t2, digitsWord.h + 28);
    if (w2 > 10 && h2 > 10) {
      const pinPng = await sharp(crop).extract({ left: l2, top: t2, width: w2, height: h2 }).resize({ width: w2 * 3, kernel: "lanczos3" })
        .extend({ top: 20, bottom: 20, left: 30, right: 30, background: "#fff" }).png().toBuffer();
      const [d] = await tesseractBatch([pinPng], { langs: "eng", psm: 7, whitelist: "0123456789" }, workDir);
      const digits = (d?.text ?? "").replace(/\D/g, "");
      if (digits.length === 6) out.pinCode = digits;
    }
  }
  return out;
}

/** Applies the section-2 box read (and the digit-only pin read) on top of a whole-page parse. */
export function applyCoverMeta(regex: CoverParse, read: CoverRead): CoverParse {
  const f = { ...regex.fields };
  let sections = regex.sections;
  if (read.sectionsText) {
    const fromBox = parseSectionList(read.sectionsText);
    if (fromBox.length >= (sections?.length ?? 0)) sections = fromBox;
  }
  if (read.metaText) {
    const box = parseCoverMetaText(read.metaText);
    for (const [k, v] of Object.entries(box) as [keyof CoverInfo, string][]) {
      // The box read is cleaner, so it wins even when empty (an empty "पंचायत :" is real).
      if (v !== undefined && !(k === "pinCode" && !v)) f[k] = v;
    }
  }
  if (read.pinCode) f.pinCode = read.pinCode;
  return { fields: f, sections, missing: regex.missing };
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

  // A printed value is Devanagari (kept, transliterated) or Latin (English roll: cleaned, no Hindi).
  const both = (printed: string): { hi: string; en: string } => {
    const v = printed.replace(/\s+/g, " ").trim();
    if (!v) return { hi: "", en: "" };
    if (/[ऀ-ॿ]/.test(v)) return { hi: v, en: translit.name(v) };
    return { hi: "", en: titleCaseIfUpper(v) };
  };
  const meta = (k: keyof CoverInfo): { hi: string; en: string } => both(cleanMetaValue(pick(k)));
  const acName = both(acNameHi), psName = both(psNameHi), psAddress = both(pick("psAddressHi"));
  const mainTownVillage = meta("mainTownVillageHi"), ward = meta("wardHi"), postOffice = meta("postOfficeHi");
  const policeStation = meta("policeStationHi"), panchayat = meta("panchayatHi"), block = meta("blockHi");
  const tehsil = meta("tehsilHi"), district = meta("districtHi");
  const pinCode = pick("pinCode", true);
  if (pinCode && pinCode.length !== 6) w.push(`${pdfLabel}: cover pin code "${pinCode}" is not 6 digits`);
  const sections: SectionEntry[] = (regex.sections ?? []).map((e) => ({ no: e.no, name: e.name, nameEn: both(e.name).en }));
  const supplementNo = pick("supplementNo", true) || fn?.supplementNo || "";
  const cover: CoverInfo = {
    stateHi, stateEn,
    acNo, acNameHi: acName.hi, acNameEn: acName.en,
    partNo,
    psNoAndNameHi, psNameHi: psName.hi, psNameEn: psName.en, psAddressHi: psAddress.hi, psAddressEn: psAddress.en,
    mainTownVillageHi: mainTownVillage.hi, mainTownVillageEn: mainTownVillage.en,
    wardHi: ward.hi, wardEn: ward.en,
    postOfficeHi: postOffice.hi, postOfficeEn: postOffice.en,
    policeStationHi: policeStation.hi, policeStationEn: policeStation.en,
    panchayatHi: panchayat.hi, panchayatEn: panchayat.en,
    blockHi: block.hi, blockEn: block.en,
    tehsilHi: tehsil.hi, tehsilEn: tehsil.en,
    districtHi: district.hi, districtEn: district.en,
    pinCode,
    sections, supplementNo,
    revisionType, revisionYear,
    qualifyingDate: pick("qualifyingDate"), publicationDate: pick("publicationDate"),
    serialFrom: num(pick("serialFrom", true)), serialTo: num(pick("serialTo", true)), totalElectors: num(pick("totalElectors", true)),
  };
  return { cover, warnings: w };
}
