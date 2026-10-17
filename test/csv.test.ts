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

test("header carries serial, page, section, cover metadata and then the audit columns", () => {
  const cols = csvHeader().split(",");
  assert.equal(cols[14], "Serial_no");
  assert.equal(cols[15], "Page_no");
  assert.equal(cols[16], "Section");
  for (const c of ["State", "AC_no", "AC_name_eg", "AC_name_hi", "Main_town_village_eg", "Main_town_village_hi", "Ward_eg", "Ward_hi",
    "Post_office_eg", "Post_office_hi", "Police_station_eg", "Police_station_hi", "Panchayat_eg", "Panchayat_hi", "Block_eg", "Block_hi",
    "Tehsil_eg", "Tehsil_hi", "District_eg", "District_hi", "Pin_code", "PS_address_eg", "PS_address_hi", "Roll_type", "Roll_year"]) {
    assert.ok(cols.includes(c), c);
  }
  assert.ok(cols.indexOf("_source_pdf") > cols.indexOf("Roll_year"));
  assert.equal(cols[cols.length - 1], "_flag_reason");
  assert.ok(!cols.includes("_serial"));
});

test("quotes Devanagari with commas and escapes quotes", () => {
  assert.equal(csvEscape("प्राथमिक विद्यालय, गढ़ी"), '"प्राथमिक विद्यालय, गढ़ी"');
  assert.equal(csvEscape('He said "hi"'), '"He said ""hi"""');
  assert.equal(csvEscape("सिंह"), "सिंह");
  assert.equal(csvEscape(""), "");
});
