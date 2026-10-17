import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanNameHi, cleanNameLatin, epicMatches, mapGender, mapRelation, normalizeEpic, parseIntLoose, parseSerialBox } from "../src/normalize.js";
import { loadTemplates, selectTemplate } from "../src/templates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const templates = loadTemplates(path.join(root, "templates"));
const tpl = selectTemplate(templates, "Uttar Pradesh");

test("template selection by state and fallback", () => {
  assert.equal(tpl.name, "uttar-pradesh");
  assert.equal(selectTemplate(templates, "Nowhere").name, "default");
  assert.equal(tpl.grid.cols, 3); // inherited from default
});

test("EPIC normalization fixes O/0 confusion only in the digit tail", () => {
  assert.deepEqual(normalizeEpic("ndt 33662O3"), { epic: "NDT3366203", corrected: true });
  assert.deepEqual(normalizeEpic("NDT3366283"), { epic: "NDT3366283", corrected: false });
  assert.deepEqual(normalizeEpic("UP/77/387/1005191"), { epic: "UP/77/387/1005191", corrected: false });
  assert.ok(epicMatches("NDT3366283", tpl));
  assert.ok(epicMatches("UP/77/387/1005191", tpl));
  assert.ok(!epicMatches("NDT33662", tpl));
});

test("closed-vocabulary relation and gender maps", () => {
  assert.equal(mapRelation("पिता", tpl), "Father");
  assert.equal(mapRelation("पति का नाम:", tpl), "Husband");
  assert.equal(mapRelation("माता", tpl), "Mother");
  assert.equal(mapRelation("", tpl), "");
  assert.equal(mapGender("पुरुष", tpl), "Male");
  assert.equal(mapGender("महिला", tpl), "Female");
  assert.equal(mapGender("तृतीय लिंग", tpl), "Other");
  assert.equal(mapGender("??", tpl), "");
});

test("Devanagari digits parse", () => {
  assert.equal(parseIntLoose("३९"), 39);
  assert.equal(parseIntLoose("age 42"), 42);
  assert.equal(parseIntLoose(""), null);
});

test("cleanNameHi drops OCR garbage but keeps real abbreviations", () => {
  assert.equal(cleanNameHi("“ ; मंजू"), "मंजू");
  assert.equal(cleanNameHi("राम@कुमार"), "राम कुमार");
  assert.equal(cleanNameHi("|| सीता"), "सीता");
  assert.equal(cleanNameHi("बिट॒टू"), "बिटटू"); // stray Vedic accent
  assert.equal(cleanNameHi("कु0 सीमा ् व"), "कु0 सीमा व"); // lone virama dropped, abbreviation kept
  assert.equal(cleanNameHi('नं प्रेमवती "७५४'), "नं प्रेमवती");
  assert.equal(cleanNameHi("शेर मौ0"), "शेर मौ0");
  assert.equal(cleanNameHi("मो. इरफान"), "मो. इरफान");
  assert.equal(cleanNameHi("ok सिंह"), "सिंह");
  assert.equal(cleanNameHi("राम-प्रसाद"), "राम-प्रसाद");
  assert.equal(cleanNameHi("  धीर   सिंह "), "धीर सिंह");
  assert.equal(cleanNameHi(""), "");
  assert.equal(cleanNameHi("754"), "");
});

test("cleanNameLatin tidies an English roll's names", () => {
  assert.equal(cleanNameLatin("DEVIKA SANTOSH PILLAI"), "Devika Santosh Pillai");
  assert.equal(cleanNameLatin("Shamsunder Mayekar"), "Shamsunder Mayekar");
  assert.equal(cleanNameLatin("Ajoy R. Raj"), "Ajoy R. Raj");
  assert.equal(cleanNameLatin("SUNITA ABHISHEK RAI 12"), "Sunita Abhishek Rai");
  assert.equal(cleanNameLatin("Panem@ Venkata | Nitheesh"), "Panem Venkata Nitheesh");
  assert.equal(cleanNameLatin("D'Souza"), "D'Souza");
  assert.equal(cleanNameLatin(""), "");
});

test("parseSerialBox separates the deletion / modification marker from the serial", () => {
  assert.deepEqual(parseSerialBox("S2 144", "2144"), { serial: 144, marker: "S", supplementNo: "2" });
  assert.deepEqual(parseSerialBox("#2 93", "293"), { serial: 93, marker: "#", supplementNo: "2" });
  assert.deepEqual(parseSerialBox("R 1084", "1084"), { serial: 1084, marker: "R", supplementNo: "" });
  assert.deepEqual(parseSerialBox("1082", "1082"), { serial: 1082, marker: "", supplementNo: "" });
  assert.deepEqual(parseSerialBox("S2144", "2144"), { serial: 144, marker: "S", supplementNo: "2" });
  assert.deepEqual(parseSerialBox("", ""), { serial: null, marker: "", supplementNo: "" });
  assert.deepEqual(parseSerialBox("I082", "1082"), { serial: 1082, marker: "", supplementNo: "" }); // letter-whitelist misread, digits read wins
  // The spaced read lost the letter; the single-word read of the same box supplies it.
  assert.deepEqual(parseSerialBox("2 144", "2144", "S2144"), { serial: 144, marker: "S", supplementNo: "2" });
  assert.deepEqual(parseSerialBox("2 144", "2144", "52144"), { serial: 144, marker: "", supplementNo: "2" });
  assert.deepEqual(parseSerialBox("R 1084", "1084", "R1084"), { serial: 1084, marker: "R", supplementNo: "" });
  assert.deepEqual(parseSerialBox("#2 93", "293", "#293"), { serial: 93, marker: "#", supplementNo: "2" });
  assert.deepEqual(parseSerialBox("7 05", "705", "705", false), { serial: 705, marker: "", supplementNo: "" }); // kerning gap inside one serial
  assert.deepEqual(parseSerialBox("08", "08", "708"), { serial: 708, marker: "", supplementNo: "" }); // leading digit lost by the line read
  assert.deepEqual(parseSerialBox("2 144", "2144", "52144", true), { serial: 144, marker: "", supplementNo: "2" });
});
