import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Logger } from "../src/logger.js";
import { mergeResults } from "../src/merge.js";
import { loadTemplates, selectTemplate } from "../src/templates.js";
import type { Config } from "../src/config.js";
import type { PdfResult, VoterCard } from "../src/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tpl = selectTemplate(loadTemplates(path.join(root, "templates")), "Uttar Pradesh");
const cfg = { confidenceThreshold: 0.7 } as Config;
const log = new Logger({ level: "error" });

function card(serial: number, epic: string, extra: Partial<VoterCard> = {}): VoterCard {
  return {
    serial, epicNo: epic, nameHi: "राम", nameEn: "Ram", relationTypeHi: "पिता", relationType: "Father",
    relationNameHi: "श्याम", relationNameEn: "Shyam", houseNo: "1", age: 30, genderHi: "पुरुष", genderEn: "Male",
    confidence: 0.95, notes: "", ...extra,
  };
}

type TestPage = { page: number; section: "main" | "supplement"; cards: VoterCard[]; printedPage?: number | null; printedTotal?: number | null };

function pdf(file: string, partNo: string, pages: TestPage[], pageCount = pages.length): PdfResult {
  return {
    schemaVersion: 1, file, hash: "x", template: "t", provider: "p", model: "m", pageCount, partNo,
    cover: {
      stateHi: "", stateEn: "Uttar Pradesh", acNo: "62", acNameHi: "दादरी", acNameEn: "Dadri", partNo, psNoAndNameHi: "", psNameHi: "PS", psNameEn: "PS",
      psAddressHi: "उच्च प्राथमिक विद्यालय", psAddressEn: "Uchch Prathmik Vidyalay",
      mainTownVillageHi: "नोएडा", mainTownVillageEn: "Noida", wardHi: "नोएडा", wardEn: "Noida", postOfficeHi: "कासना", postOfficeEn: "Kasna",
      policeStationHi: "नॉलेज पार्क", policeStationEn: "Knowledge Park", panchayatHi: "", panchayatEn: "", blockHi: "", blockEn: "",
      tehsilHi: "गौतमबुद्धनगर", tehsilEn: "Gautam Buddh Nagar", districtHi: "गौतम बुद्ध नगर", districtEn: "Gautam Buddh Nagar", pinCode: "201308",
      revisionType: "Final", revisionYear: "2024", qualifyingDate: "", publicationDate: "", serialFrom: 1, serialTo: null, totalElectors: null,
    },
    pages: pages.map((p) => ({
      page: p.page, pageType: p.section === "main" ? "voter_grid" : "supplement_grid", partNo, sectionHeader: "", section: p.section,
      cards: p.cards, cover: null, warnings: [], usage: { inputTokens: 0, outputTokens: 0, calls: 0 }, durationMs: 0,
      printedPage: p.printedPage, printedTotal: p.printedTotal,
    })),
    status: "ok", startedAt: "", finishedAt: "", usage: { inputTokens: 0, outputTokens: 0, calls: 0 },
  };
}

const constituency = { folder: "/x", state: "Uttar Pradesh", acNo: "62", acName: "Dadri", year: "2024", type: "Final", parsed: true };

test("later-read row replaces the earlier one with the same EPIC, position preserved", () => {
  const r = pdf("a.pdf", "1", [
    { page: 3, section: "main", cards: [card(1, "NDT0000001"), card(2, "NDT0000002", { age: 40 })] },
    { page: 9, section: "supplement", cards: [card(300, "NDT0000002", { age: 41, nameEn: "Ram Updated" })] },
  ]);
  const { rows, stats } = mergeResults([r], constituency, tpl, cfg, log);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].Epic_no, "NDT0000002");
  assert.equal(rows[1].age, "41");
  assert.equal(rows[1].Name_eg, "Ram Updated");
  assert.equal(rows[1]._page, "9");
  assert.ok(rows[1]._flag_reason.includes("dup_epic_replaced_earlier"));
  assert.equal(stats.duplicatesReplaced, 1);
});

test("rows without EPIC are kept and flagged, never dropped", () => {
  const r = pdf("a.pdf", "1", [{ page: 3, section: "main", cards: [card(1, ""), card(2, ""), card(3, "NDT0000003", { age: 200, confidence: 0.3 })] }]);
  const { rows } = mergeResults([r], constituency, tpl, cfg, log);
  assert.equal(rows.length, 3);
  assert.ok(rows[0]._flag_reason.includes("epic_missing"));
  assert.ok(rows[2]._flag_reason.includes("age_out_of_range"));
  assert.ok(rows[2]._flag_reason.includes("low_confidence"));
});

test("cross-check warns when cover disagrees with folder name", () => {
  const r = pdf("a.pdf", "1", [{ page: 3, section: "main", cards: [card(1, "NDT0000001")] }]);
  r.cover!.acNo = "99";
  const { stats } = mergeResults([r], constituency, tpl, cfg, log);
  assert.ok(stats.warnings.some((w) => w.includes("AC no")));
});

test("every row carries serial, printed page number, section and the cover metadata", () => {
  const r = pdf("a.pdf", "794", [
    { page: 3, section: "main", cards: [card(1, "NDT0000001"), card(2, "NDT0000002")], printedPage: 3, printedTotal: 42 },
    { page: 4, section: "main", cards: [card(3, "NDT0000003")], printedPage: null, printedTotal: null }, // footer unreadable
    { page: 5, section: "main", cards: [card(4, "NDT0000004")], printedPage: 6, printedTotal: 42 }, // trusted (total matches), but differs
    { page: 6, section: "supplement", cards: [card(300, "NDT0000005")], printedPage: 9, printedTotal: 7 }, // not trusted
  ], 42);
  const { rows, stats } = mergeResults([r], constituency, tpl, cfg, log);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((x) => x.Serial_no), ["1", "2", "3", "4", "300"]);
  assert.deepEqual(rows.map((x) => x.Page_no), ["3", "3", "4", "6", "6"]);
  assert.deepEqual(rows.map((x) => x._page), ["3", "3", "4", "5", "6"]);
  assert.ok(rows[3]._flag_reason.includes("page_no_mismatch"));
  assert.ok(!rows[2]._flag_reason.includes("page_no_mismatch"));
  assert.ok(stats.warnings.some((w) => /p6: footer page number 9/.test(w)));
  assert.deepEqual(rows.map((x) => x.Section), ["main", "main", "main", "main", "supplement"]);
  for (const row of rows) {
    assert.equal(row.State, "Uttar Pradesh");
    assert.equal(row.AC_no, "62");
    assert.equal(row.AC_name_eg, "Dadri");
    assert.equal(row.AC_name_hi, "दादरी");
    assert.equal(row.Main_town_village_eg, "Noida");
    assert.equal(row.Post_office_hi, "कासना");
    assert.equal(row.Police_station_eg, "Knowledge Park");
    assert.equal(row.Panchayat_eg, "");
    assert.equal(row.Tehsil_eg, "Gautam Buddh Nagar");
    assert.equal(row.District_hi, "गौतम बुद्ध नगर");
    assert.equal(row.Pin_code, "201308");
    assert.equal(row.PS_address_eg, "Uchch Prathmik Vidyalay");
    assert.equal(row.Roll_type, "Final");
    assert.equal(row.Roll_year, "2024");
  }
});

test("cover metadata falls back to the folder name when the cover was not read", () => {
  const r = pdf("a.pdf", "794", [{ page: 3, section: "main", cards: [card(1, "NDT0000001")] }]);
  r.cover = null;
  const { rows } = mergeResults([r], constituency, tpl, cfg, log);
  assert.equal(rows[0].State, "Uttar Pradesh");
  assert.equal(rows[0].AC_no, "62");
  assert.equal(rows[0].AC_name_eg, "Dadri");
  assert.equal(rows[0].Roll_type, "Final");
  assert.equal(rows[0].Pin_code, "");
  assert.equal(rows[0].Page_no, "3");
});
