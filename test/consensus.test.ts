import assert from "node:assert/strict";
import { test } from "node:test";
import { correctNames, singleEdit } from "../src/consensus.js";
import type { VoterCard } from "../src/types.js";

const card = (nameHi: string, nameConf: number, relationNameHi = "", relationConf = 1): VoterCard => ({
  serial: 1, epicNo: "NDT0000001", nameHi, nameEn: "", relationTypeHi: "पिता", relationType: "Father",
  relationNameHi, relationNameEn: "", houseNo: "1", age: 30, genderHi: "पुरुष", genderEn: "Male",
  confidence: Math.min(nameConf, relationConf), notes: "", extraFlags: [], fieldConf: { name: nameConf, relationName: relationConf },
});

test("singleEdit accepts only OCR-typical edits", () => {
  assert.equal(singleEdit("मौहममद", "मौहम्मद"), "mark"); // dropped halant
  assert.equal(singleEdit("चचल", "चंचल"), "mark"); // dropped anusvara
  assert.equal(singleEdit("शैर", "शेर"), "mark"); // look-alike matra
  assert.equal(singleEdit("बशील", "वशील"), "confusion"); // ब/व
  assert.equal(singleEdit("थीर", "धीर"), "confusion");
  assert.equal(singleEdit("चन्दा", "चन्द"), null); // a matra is never dropped
  assert.equal(singleEdit("चन्द", "चन्दा"), null); // nor added
  assert.equal(singleEdit("राम", "रामू"), null);
  assert.equal(singleEdit("कमल", "कपल"), null); // not a confusion pair
  assert.equal(singleEdit("विट्रो", "बिट्टो"), null); // two edits
});

test("low-confidence reads are repaired from the lexicon and from the document", () => {
  const known = new Set(["मौहम्मद", "शेर"]);
  const cards = [
    card("वशील", 0.95), // confident, supports itself
    card("इशाराना", 0.9, "वशील", 0.9), // second confident occurrence -> वशील is trusted
    card("बशील", 0.6), // low confidence -> repaired by document support
    card("शैर मौहममद", 0.5), // low confidence -> both tokens repaired from the lexicon
  ];
  const n = correctNames(cards, { known });
  assert.equal(n, 2);
  assert.equal(cards[2].nameHi, "वशील");
  assert.deepEqual(cards[2].extraFlags, ["name_hi_corrected"]);
  assert.match(cards[2].notes, /read as "बशील"/);
  assert.equal(cards[3].nameHi, "शेर मौहम्मद");
});

test("a confident read is only overruled by strong evidence", () => {
  const known = new Set(["खुरशेद", "चन्द", "मौहम्मद", "शेर"]);
  const cards = [
    card("चन्दा", 0.95), // confident rare spelling, candidate only in lexicon -> kept
    card("खुरशैद", 0.95), // confident, lexicon candidate not seen in document -> kept
    card("मौहममद", 0.95), // dropped halant to a known token -> repaired even though confident
    card("शैर", 0.95), // look-alike matra, candidate known AND read here -> repaired
    card("शेर", 0.95),
  ];
  correctNames(cards, { known });
  assert.equal(cards[0].nameHi, "चन्दा");
  assert.equal(cards[1].nameHi, "खुरशैद");
  assert.equal(cards[2].nameHi, "मौहम्मद");
  assert.equal(cards[3].nameHi, "शेर");
});
