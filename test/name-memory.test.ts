import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { NameMemory } from "../src/name-memory.js";
import type { VoterCard } from "../src/types.js";

const card = (nameHi: string, nameConf: number, extraFlags: string[] = []): VoterCard => ({
  serial: 1, epicNo: "NDT0000001", nameHi, nameEn: "", relationTypeHi: "पिता", relationType: "Father",
  relationNameHi: "", relationNameEn: "", houseNo: "1", age: 30, genderHi: "पुरुष", genderEn: "Male",
  confidence: nameConf, notes: "", extraFlags, fieldConf: { name: nameConf, relationName: 0 },
});
const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "names-")), "hi-names.json");

test("a token is trusted only after confident reads in two different PDFs", () => {
  const m = new NameMemory(tmpFile());
  assert.equal(m.learnFrom("aaaa", [card("मुनेन्दर", 0.95), card("मुनेन्दर", 0.95)]), 0); // same PDF twice: not enough
  assert.equal(m.learnFrom("aaaa", [card("मुनेन्दर", 0.95)]), 0); // re-running a PDF adds nothing
  assert.equal(m.learnFrom("bbbb", [card("मुनेन्दर", 0.92)]), 1);
  assert.ok(m.learned().has("मुनेन्दर"));
});

test("low-confidence reads, repaired fields and non-names are not learned", () => {
  const m = new NameMemory(tmpFile());
  for (const h of ["aaaa", "bbbb", "cccc"]) {
    m.learnFrom(h, [card("विट्रो", 0.6), card("खुरशेद", 0.95, ["name_hi_corrected"]), card("राम 12 A", 0.95)]);
  }
  assert.deepEqual([...m.learned()], ["राम"]);
});

test("memory survives a save/load round trip", () => {
  const f = tmpFile();
  const m = new NameMemory(f);
  m.learnFrom("aaaa", [card("धीर सिंह", 0.95)]);
  m.learnFrom("bbbb", [card("धीर", 0.95)]);
  m.save();
  const again = new NameMemory(f);
  assert.deepEqual([...again.learned()], ["धीर"]);
  assert.equal(again.stats().candidates, 2);
  assert.equal(again.stats().newThisRun, 0);
});
