import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyHeader, cleanSectionName, parseCardBody, parseEpicText, parseFooterText } from "../src/local.js";
import { fixSerials } from "../src/pipeline.js";
import { loadTemplates, selectTemplate } from "../src/templates.js";
import { parseTsv, type TessResult } from "../src/tesseract.js";
import { editDistance } from "../src/util.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templates = loadTemplates(path.join(root, "templates"));
const tpl = selectTemplate(templates, "Uttar Pradesh");
const goa = selectTemplate(templates, "Goa");

/** Builds a TessResult from lines of "word(conf) word(conf)". */
function tess(lines: string[]): TessResult {
  const out: TessResult = { text: "", words: [], lines: [] };
  lines.forEach((l, li) => {
    const words = [...l.matchAll(/(\S+?)\((\d+)\)/g)].map((m, wi) => ({
      text: m[1], conf: Number(m[2]), x: wi * 10, y: li * 20, w: 10, h: 10, block: 1, par: 1, line: li + 1,
    }));
    out.words.push(...words);
    out.lines.push({ text: words.map((w) => w.text).join(" "), conf: Math.min(...words.map((w) => w.conf)), words });
  });
  out.text = out.lines.map((l) => l.text).join("\n");
  return out;
}

test("parseCardBody reads the four card lines with value confidences", () => {
  const r = tess([
    "नाम(90) :(90) मुनेन्दर(74)",
    "पिता(96) का(96) नाम:(93) धीर(85) सिंह(96)",
    "मकान(91) संख्या(92) :(92) 00(96)",
    "आयु(93) :(92) 39(95) लिंग(92) :(92) पुरुष(97)",
  ]);
  const b = parseCardBody(r, tpl);
  assert.equal(b.nameHi, "मुनेन्दर");
  assert.equal(b.nameConf, 74);
  assert.equal(b.relationTypeHi, "पिता");
  assert.equal(b.relationNameHi, "धीर सिंह");
  assert.equal(b.relationConf, 85);
  assert.equal(b.houseNo, "00");
  assert.equal(b.age, 39);
  assert.equal(b.genderHi, "पुरुष");
  assert.equal(b.ageGenderConf, 95);
  assert.equal(b.deleted, false);
});

test("parseCardBody tolerates a damaged house label and a husband relation", () => {
  const r = tess([
    "नाम(90) :(90) हाजरा(88)",
    "पति(96) का(96) नाम:(93) मज्जी(88)",
    "सकान(70) संख्या(93) :(0) 1(95)",
    "आयु(87) :(87) 69(96) लिंग(92) :(93) महिला(96)",
  ]);
  const b = parseCardBody(r, tpl);
  assert.equal(b.relationTypeHi, "पति");
  assert.equal(b.relationNameHi, "मज्जी");
  assert.equal(b.houseNo, "1");
  assert.equal(b.age, 69);
  assert.equal(b.genderHi, "महिला");
});

test("parseEpicText pulls an EPIC out of noisy text", () => {
  assert.equal(parseEpicText("1 NDT3366283"), "NDT3366283");
  assert.equal(parseEpicText("UP/77/387/1005191 "), "UP/77/387/1005191");
  assert.equal(parseEpicText("२ NDT७२७२०५७"), "NDT7272057");
});

test("classifyHeader recognises page kinds, part / section / list numbers from the header strip", () => {
  const h1 = "निर्वाचक नामावली -2026 ,विधानसभा निर्वाचन क्षेत्र: : 62-दादरी भाग संख्या : : 794\nअनुभाग संख्या और नाम : 1-गढी समस्तपुर";
  assert.deepEqual(classifyHeader(h1, true, 3, tpl), {
    pageType: "voter_grid", partNo: "794", sectionHeader: "अनुभाग संख्या और नाम : 1-गढी समस्तपुर", sectionNo: "1", sectionName: "गढी समस्तपुर", supplementNo: "",
  });
  const h2 = "निर्वाचक नामावली -2026 भाग संख्या : : 794\nपरिवर्धन की सूची 1 (06-01-2026 01-04-2026)";
  assert.equal(classifyHeader(h2, true, 14, tpl).pageType, "supplement_grid");
  assert.equal(classifyHeader(h2, true, 14, tpl).supplementNo, "1");
  const h3 = "भाग संख्या : : 793\nविलोपन की सूची 1";
  assert.equal(classifyHeader(h3, true, 40, tpl).pageType, "deletion_grid");
  assert.equal(classifyHeader("anything", false, 1, tpl).pageType, "cover");
  // English roll, with the junk of the first card row that a wide header crop picks up.
  const e1 = "Assembly Constituency No and Name: 26-DABOLIM Part No. :1\nSection No and Name 1-Near Sohia Pay Phone, New Vaddem\n4 WLICO039404 9 WILICO040774";
  const r1 = classifyHeader(e1, true, 3, goa);
  assert.equal(r1.pageType, "voter_grid");
  assert.equal(r1.partNo, "1");
  assert.equal(r1.sectionNo, "1");
  assert.equal(r1.sectionName, "Near Sohia Pay Phone, New Vaddem");
  // A separately published supplement: the description line names all three lists, the heading names one.
  const e2 = "Supplement 2\nList of Addition, Deletion and Modification carried out during Continuous Updation with respect to Ist April 2026\nAssembly Constituency No and Name : 26-DABOLIM Part No. :17\n2- List of Deletions";
  const r2 = classifyHeader(e2, true, 2, goa);
  assert.equal(r2.pageType, "deletion_grid");
  assert.equal(r2.partNo, "17");
  assert.equal(r2.supplementNo, "2");
  assert.equal(classifyHeader(e2.replace("2- List of Deletions", "3- List of Modifications"), true, 3, goa).pageType, "modification_grid");
  assert.equal(classifyHeader(e2.replace("2- List of Deletions", "1- List of Additions"), true, 1, goa).pageType, "supplement_grid");
  assert.equal(classifyHeader("Assembly Constituency No and Name : 26-DABOLIM Part No. : 1\nSUMMARY OF ELECTORS", false, 37, goa).pageType, "summary");
  assert.equal(classifyHeader("Assembly Constituency No and Name : 26-DABOLIM Part No. :1\n1- List of Additions 1 (16-12-2025 19-01-2026 )", true, 36, goa).supplementNo, "1");
  assert.equal(cleanSectionName("कामबक्शपुर ok |fast", "devanagari"), "कामबक्शपुर"); // tokens of the other script are OCR debris
  assert.equal(cleanSectionName("Near Sohia Pay Phone, New Vaddem नि", "latin"), "Near Sohia Pay Phone, New Vaddem");
  // grid-looking page with an unreadable header -> null (ask the model)
  assert.equal(classifyHeader("भाग संख्या : : 794", true, 16, tpl).pageType, null);
  assert.equal(classifyHeader("भाग संख्या : : 794", false, 2, tpl).pageType, "other");
});

test("parseCardBody reads an English (Goa) card", () => {
  const b = parseCardBody(tess([
    "Name(95) :(90) Shamsunder(93) Mayekar(92)",
    "Fathers(94) Name:(90) Shambhu(93) Mayekar(91)",
    "House(96) Number(95) :(90) 17(97)",
    "Age(95) :(90) 68(96) Gender(94) :(90) Male(95)",
  ]), goa);
  assert.equal(b.nameHi, "Shamsunder Mayekar");
  assert.equal(b.relationTypeHi, "Father");
  assert.equal(b.relationNameHi, "Shambhu Mayekar");
  assert.equal(b.houseNo, "17");
  assert.equal(b.age, 68);
  assert.equal(b.genderHi, "Male");
  assert.equal(b.deleted, false);
  const h = parseCardBody(tess([
    "Name(95) :(90) SEEMA(93) ASHOK(92) TIWARI(90)",
    "Husband's(94) Name:(90) ASHOK(93) TIWARI(91)",
    "House(96) Number(95) :(90) HNO(80) 170(97)",
    "Age(95) :(90) 48(96) Gender(94) :(90) Female(95)",
  ]), goa);
  assert.equal(h.relationTypeHi, "Husband");
  assert.equal(h.relationNameHi, "ASHOK TIWARI");
  assert.equal(h.houseNo, "HNO 170");
  assert.equal(h.genderHi, "Female");
  // "Female" never matches as "Male"; a stamped card is flagged.
  const d = parseCardBody(tess(["Name(95) :(90) Suman(93) Jogin(92)", "Fathers(94) Name:(90) Francis(70) Jogin(60)", "House(96) Number(95) :(90) 70(97) DELETED(40)", "Age(95) :(90) 34(96) Gender(94) :(90) Female(95)"]), goa);
  assert.equal(d.deleted, true);
  assert.equal(d.genderHi, "Female");
});

test("fixSerials derives serials from grid order and reports corrections", () => {
  const { serials, corrected } = fixSerials([1, 2, 3, 4, 5, 4, 7, 8, null, 10]);
  assert.deepEqual(serials, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(corrected, [5, 8]);
  // supplement page: box reads glue the supplement number on ("3111" for 311)
  const s2 = fixSerials([310, 3111, 312, 313, 3141, 315]);
  assert.deepEqual(s2.serials, [310, 311, 312, 313, 314, 315]);
  // too little agreement -> raw reads kept
  const s3 = fixSerials([null, null, 7]);
  assert.deepEqual(s3.serials, [null, null, 7]);
});

test("parseTsv groups words into lines per page", () => {
  const tsv = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    "1\t1\t0\t0\t0\t0\t0\t0\t100\t100\t-1\t",
    "5\t1\t1\t1\t1\t1\t0\t0\t10\t10\t90\tनाम",
    "5\t1\t1\t1\t1\t2\t12\t0\t10\t10\t80\t:",
    "5\t1\t1\t1\t2\t1\t0\t20\t10\t10\t70\tआयु",
    "5\t2\t1\t1\t1\t1\t0\t0\t10\t10\t60\tNDT1234567",
  ].join("\n");
  const [p1, p2] = parseTsv(tsv, 2);
  assert.equal(p1.lines.length, 2);
  assert.equal(p1.lines[0].text, "नाम :");
  assert.equal(p1.lines[0].conf, 80);
  assert.equal(p2.text, "NDT1234567");
});

test("editDistance counts code points", () => {
  assert.equal(editDistance("मौहममद", "मौहम्मद"), 1);
  assert.equal(editDistance("abc", "abc"), 0);
});

test("parseFooterText reads the printed page number and total", () => {
  assert.deepEqual(parseFooterText("रहता दिनांक : 0-0-2026 के अनुसार आयु प्रकाशन की तिथि :- 70-04-2026 कुल पृष्ठ 42 - पृष्ठ 40").page, 40);
  assert.equal(parseFooterText("कुल पृष्ठ 42 - पृष्ठ 40").total, 42);
  assert.deepEqual(parseFooterText("कुल पृष्ठ १६ - पृष्ठ १"), { page: 1, total: 16, text: "कुल पृष्ठ 16 - पृष्ठ 1" });
  assert.equal(parseFooterText("Page 3 of 16").page, 3);
  assert.deepEqual(parseFooterText("Age as on 01-01-2026 #/#1 Modified as per supplement Date of Publication :- 21-02-2026 Total Pages 37 - Page 3").page, 3);
  assert.equal(parseFooterText("Total Pages 37 - Page 3").total, 37);
  assert.equal(parseFooterText("Page 3 of 16").total, 16);
  assert.equal(parseFooterText("कुल पृष्ठ 42 - पृ 40").total, 42);
  assert.deepEqual(parseFooterText("nothing here"), { page: null, total: null, text: "nothing here" });
});
