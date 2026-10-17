import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanNameHi, epicMatches, mapGender, mapRelation, normalizeEpic, parseIntLoose } from "../src/normalize.js";
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
