import assert from "node:assert/strict";
import { test } from "node:test";
import { outputCsvName, outputDirName, parseConstituencyFolder, partCsvName } from "../src/folder.js";

test("parses the folder convention and builds the CSV name", () => {
  const c = parseConstituencyFolder("raw-data/Uttar Pradesh/390-Varanasi Cantt-2024-Final");
  assert.equal(c.state, "Uttar Pradesh");
  assert.equal(c.acNo, "390");
  assert.equal(c.acName, "Varanasi Cantt");
  assert.equal(c.year, "2024");
  assert.equal(c.type, "Final");
  assert.equal(outputCsvName(c), "Uttar Pradesh-390-Varanasi Cantt-2024-Final.csv");
});

test("AC names containing dashes survive", () => {
  const c = parseConstituencyFolder("raw-data/Bihar/12-Patna-Sahib-2025-draft");
  assert.equal(c.acNo, "12");
  assert.equal(c.acName, "Patna-Sahib");
  assert.equal(c.type, "Draft");
});

test("non-matching folder names are flagged, not fatal", () => {
  const c = parseConstituencyFolder("raw-data/Bihar/whatever");
  assert.equal(c.parsed, false);
  assert.equal(outputCsvName(c), "Bihar-whatever.csv");
});

test("per-part CSV name and output directory follow the requested layout", () => {
  const c = parseConstituencyFolder("raw-data/Uttar Pradesh/390-Varanasi Cantt-2024-Final");
  assert.equal(outputDirName(c), "390-Varanasi Cantt-2024");
  assert.equal(partCsvName(c, "794"), "Uttar Pradesh-390-Varanasi Cantt-2024-Final794.csv");
  assert.equal(partCsvName(c, ""), "Uttar Pradesh-390-Varanasi Cantt-2024-Finalunknown.csv");
  assert.equal(partCsvName(c, "7/9"), "Uttar Pradesh-390-Varanasi Cantt-2024-Final7_9.csv");
});
