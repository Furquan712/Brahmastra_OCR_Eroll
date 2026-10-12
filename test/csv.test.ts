import assert from "node:assert/strict";
import { test } from "node:test";
import { csvEscape, csvHeader } from "../src/csv.js";

test("header starts with the 14 dashboard columns in order", () => {
  assert.ok(
    csvHeader().startsWith(
      "PS_name_eg,PS_name_hi,Part_no,Epic_no,Name_eg,Name_hi,Relation_type_eg,Relation_type_hi,Relation_name_eg,Relation_name_hi,house_no,age,Gender_eg,Gender_hi",
    ),
  );
});

test("quotes Devanagari with commas and escapes quotes", () => {
  assert.equal(csvEscape("प्राथमिक विद्यालय, गढ़ी"), '"प्राथमिक विद्यालय, गढ़ी"');
  assert.equal(csvEscape('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvEscape("सिंह"), "सिंह");
  assert.equal(csvEscape(""), "");
});
