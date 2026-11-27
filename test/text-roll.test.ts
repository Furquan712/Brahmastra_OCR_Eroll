import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { loadTemplates, selectTemplate } from "../src/templates.js";
import { coverCounts, parseGridPage, visualRows, type TextLine } from "../src/text-roll.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tpl = selectTemplate(loadTemplates(path.join(root, "templates")), "Uttar Pradesh");

const at = (x: number, y: number, text: string): TextLine => [x, y, x + text.length * 3, y + 9.5, text];
function card(col: number, top: number, serial: string, epic: string, body: string[]): TextLine[] {
  const x = 190 * col;
  return [at(x + 68, top + 1, serial), ...(epic ? [at(x + 154, top, epic)] : []), at(x + 155, top + 30, "फोटो उपलब्ध है"),
    ...body.map((t, i) => at(x + 19, top + 14 + i * 9, t))];
}

test("cards are read by position, three to a row, with the photo label ignored", () => {
  const lines = [
    at(16, 5, "निर्वाचक नामावली -2027"),
    ...card(0, 31, "1", "WSK4101796", ["नाम : क ख", "अन्य: ग", "मकान संख्या : 0", "आयु : 47 लिंग : पुरुष"]),
    ...card(1, 31, "2", "UP\\28\\137\\0459373", ["नाम : घ", "पति का नाम: च छ", "मकान संख्या : 373 ग", "आयु : 38 लिंग : महिला"]),
    ...card(2, 31, "3", "", ["नाम : ज", "पिता का नाम: झ", "ट ठ", "मकान संख्या : 00", "आयु : 28 लिंग : तृतीय लिंग"]),
    ...card(0, 111, "4", "Yyh0842823", ["नाम : ड", "माता का नाम: ढ", "मकान संख्या : 5", "आयु : 90 लिंग : महिला"]),
  ];
  const cards = parseGridPage(lines, tpl);
  assert.deepEqual(cards.map((c) => [c.serial, c.epicNo, c.relationType, c.genderEn, c.age]), [
    [1, "WSK4101796", "Other", "Male", 47],
    [2, "UP/28/137/0459373", "Husband", "Female", 38],
    [3, "", "Father", "Other", 28],
    [4, "YYH0842823", "Mother", "Female", 90],
  ]);
  assert.equal(cards[1].houseNo, "373 ग");
  assert.equal(cards[2].relationNameHi, "झ ट ठ", "a wrapped name continues on the next line");
  assert.ok(cards.every((c) => !c.marker && !c.notes && c.engine === "text"));
});

test("the cover's electors table is read from its own row", () => {
  const lines = [at(20, 500, "4. निर्वाचकों की संख्या :"), at(30, 520, "प्रारम्भिक क्रम"),
    ...["1", "948", "502", "446", "0", "948"].map((v, i) => at(40 + i * 80, 560, v))];
  assert.deepEqual(coverCounts(lines), { from: 1, to: 948, male: 502, female: 446, other: 0, total: 948 });
  assert.equal(visualRows(lines).at(-1), "1 948 502 446 0 948");
});
