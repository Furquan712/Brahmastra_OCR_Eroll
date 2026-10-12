import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Transliterator } from "../src/translit.js";
import { clusterKey, parseWord } from "../src/translit/devanagari.js";
import { alignSlots, trainModel, transliterateWord } from "../src/translit/model.js";
import { schwaKeep, slotsOf } from "../src/translit/rules.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data", "translit");

test("parseWord splits Devanagari into consonant clusters, vowels and marks", () => {
  const u = parseWord("लक्ष्मी");
  assert.equal(u.length, 2);
  assert.equal(clusterKey(u[1].cons), "क्ष्म");
  assert.equal(u[1].vowel, "ी");
  const s = parseWord("सिंह");
  assert.equal(s[0].nasal, "ं");
  assert.equal(s[1].vowel, null); // inherent
  const f = parseWord("फ़रज़ाना"); // precomposed nukta letters are split by NFC and kept as nukta
  assert.equal(f[0].cons[0].base, "फ");
  assert.equal(f[0].cons[0].nukta, true);
  const x = parseWord("क.");
  assert.deepEqual(x.map((v) => v.kind), ["C", "X"]);
  assert.equal(parseWord("१२")[0].text, "1");
});

test("schwa deletion follows spoken Hindi", () => {
  const keep = (w: string) => schwaKeep(parseWord(w)).map((k) => (k ? 1 : 0)).join("");
  assert.equal(keep("कमल"), "110"); // Ka-mal
  assert.equal(keep("कमला"), "101"); // Kam-la
  assert.equal(keep("रामचंद्र"), "1011"); // Ram-chan-dra (nasal keeps, final cluster ends in र)
  assert.equal(keep("चंद"), "10"); // Chand
  assert.equal(keep("समस्तपुर"), "11010"); // Sa-mast-pur: a stop-final cluster drops its schwa
  assert.equal(keep("लक्ष्मण"), "110"); // Lakshman
});

const rules = (w: string) => transliterateWord(w, null);

test("rule engine romanises common names without any data", () => {
  const cases: [string, string][] = [
    ["सुरेश", "suresh"], ["कमला", "kamla"], ["सत्यनारायण", "satyanarayan"], ["रामकुमार", "ramkumar"],
    ["ओमप्रकाश", "omprakash"], ["विश्वकर्मा", "vishwakarma"], ["मोहम्मद", "mohammad"], ["बिशम्बर", "bishambar"],
    ["अंजलि", "anjali"], ["दीपक", "deepak"], ["पूजा", "pooja"], ["बाबू", "babu"], ["तिवारी", "tiwari"],
    ["जसवंत", "jaswant"], ["आरिफ", "arif"], ["यादव", "yadav"], ["शंकर", "shankar"], ["कृष्ण", "krishna"],
    ["लक्ष्मी", "lakshmi"], ["ज्ञानचंद", "gyanchand"], ["फ़रज़ाना", "farzana"], ["खचेडा", "khacheda"],
  ];
  for (const [hi, en] of cases) assert.equal(rules(hi), en, hi);
});

test("alignment finds the alternatives behind an attested spelling", () => {
  const slots = slotsOf(parseWord("सिंह"));
  const idx = alignSlots(slots, "singh");
  assert.ok(idx);
  assert.equal(slots.map((s, i) => s.alts[idx![i]]).join(""), "singh");
  assert.equal(alignSlots(slotsOf(parseWord("राम")), "xyz"), null);
});

test("training changes decisions by context and builds a lexicon", () => {
  const { model, report } = trainModel([
    { hi: "फूल", en: "Phool", weight: 1 }, { hi: "फूलचंद", en: "Phoolchand", weight: 1 }, { hi: "फूलवती", en: "Phoolwati", weight: 1 },
    { hi: "फरीदा", en: "Farida", weight: 1 }, { hi: "आरिफ", en: "Arif", weight: 1 }, { hi: "सिंह", en: "Singh", weight: 5 },
    { hi: "धीर सिंह", en: "Dhir Singh", weight: 1 },
  ]);
  assert.equal(report.skipped.length, 0, JSON.stringify(report.skipped));
  assert.equal(model.lexicon["सिंह"].en, "Singh");
  assert.equal(model.lexicon["सिंह"].n, 6);
  assert.equal(transliterateWord("फूलसिंह", model), "phoolsingh"); // फू -> "phoo" learned, ंह -> "ngh" learned
  assert.equal(transliterateWord("आसिफ", model), "asif"); // फ elsewhere still "f"
});

test("Transliterator applies overrides, lexicon and capitalisation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "translit-"));
  fs.writeFileSync(path.join(dir, "overrides.tsv"), "सिंह\tSingh\nक.नं.\tK.No.\n");
  const t = new Transliterator(dir);
  assert.equal(t.stats.modelFile, null);
  assert.equal(t.name("धीर सिंह"), "Dheer Singh");
  assert.equal(t.name("प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1"), "Prathmik Vidyalay Garhi Samastpur K.No. 1");
  assert.equal(t.name("  राम-कुमार  "), "Ram-Kumar");
  assert.equal(t.name("NDT123"), "NDT123");
  assert.equal(t.name(""), "");
});

test("shipped model and seed data give expected spellings", { skip: !fs.existsSync(path.join(dataDir, "model.json")) && "model.json not built" }, () => {
  const t = new Transliterator(dataDir);
  assert.equal(t.name("धीर सिंह"), "Dhir Singh");
  assert.equal(t.name("ईश्वरी देवी"), "Ishwari Devi");
  assert.equal(t.name("आशमौहम्मद"), "Ashmohammad");
  assert.equal(t.name("मुनेन्दर"), "Munendar");
  assert.equal(t.name("इसरार"), "Israr");
  assert.equal(t.name("नरेश कुमार"), "Naresh Kumar");
});
