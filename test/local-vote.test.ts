import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fuzzyGender, mergeBodies, voteEpic, voteName, type BodyFields } from "../src/local.js";
import { loadTemplates, selectTemplate } from "../src/templates.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tpl = selectTemplate(loadTemplates(path.join(root, "templates")), "Uttar Pradesh");

test("voteName drops Latin garbage and rewards agreement", () => {
  assert.deepEqual(voteName({ v: "ok सिंह", conf: 90 }, { v: "धीर सिंह", conf: 80 }), { v: "धीर सिंह", conf: 80 });
  assert.deepEqual(voteName({ v: "मुनेन्दर", conf: 74 }, { v: "मुनेन्दर", conf: 88 }), { v: "मुनेन्दर", conf: 93 });
  assert.deepEqual(voteName({ v: "बशील", conf: 70 }, { v: "वशील", conf: 85 }), { v: "वशील", conf: 85 });
  assert.deepEqual(voteName({ v: "fast", conf: 90 }, { v: "", conf: 0 }), { v: "fast", conf: 90 }); // kept so the flag fires
});

test("voteEpic takes the majority and distrusts a lone read", () => {
  assert.deepEqual(voteEpic([{ v: "NDT3366283", conf: 90 }, { v: "NDT3366283", conf: 95 }, { v: "NDT3366288", conf: 60 }], tpl), { v: "NDT3366283", conf: 95 });
  assert.deepEqual(voteEpic([{ v: "NDT336628", conf: 90 }, { v: "NDT3366283", conf: 92 }, { v: "", conf: 0 }], tpl), { v: "NDT3366283", conf: 75 });
  assert.deepEqual(voteEpic([{ v: "NDT33", conf: 90 }, { v: "", conf: 0 }, { v: "", conf: 0 }], tpl), { v: "NDT33", conf: 50 });
});

test("fuzzyGender tolerates one wrong character", () => {
  const g = ["पुरुष", "महिला"];
  assert.equal(fuzzyGender(["आयु", ":", "39", "लिंग", ":", "पुरूष"], g), "पुरुष");
  assert.equal(fuzzyGender(["महीला"], g), "महिला");
  assert.equal(fuzzyGender(["xyz"], g), "");
});

test("mergeBodies takes names from the Hindi pass and digits from the eng+hin pass", () => {
  const A: BodyFields = { nameHi: "art", nameConf: 80, relationTypeHi: "पति", relationNameHi: "आस मौहम्मद", relationConf: 85, houseNo: "2", houseConf: 95, age: 61, genderHi: "महिला", ageGenderConf: 93, deleted: false };
  const B: BodyFields = { nameHi: "बानो", nameConf: 82, relationTypeHi: "", relationNameHi: "आस मौहम्मद", relationConf: 70, houseNo: "", houseConf: 0, age: 61, genderHi: "महिला", ageGenderConf: 80, deleted: false };
  const m = mergeBodies(A, B);
  assert.equal(m.nameHi, "बानो");
  assert.equal(m.relationTypeHi, "पति");
  assert.equal(m.relationNameHi, "आस मौहम्मद");
  assert.equal(m.relationConf, 90); // both passes agree -> +5
  assert.equal(m.houseNo, "2");
  assert.equal(m.age, 61);
  assert.equal(m.ageGenderConf, 98);
});
