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

function pdf(file: string, partNo: string, pages: { page: number; section: "main" | "supplement"; cards: VoterCard[] }[]): PdfResult {
  return {
    schemaVersion: 1, file, hash: "x", template: "t", provider: "p", model: "m", pageCount: pages.length, partNo,
    cover: {
      stateHi: "", stateEn: "Uttar Pradesh", acNo: "62", acNameHi: "", acNameEn: "", partNo, psNoAndNameHi: "", psNameHi: "PS", psNameEn: "PS",
      psAddressHi: "", revisionType: "Final", revisionYear: "2024", qualifyingDate: "", publicationDate: "", serialFrom: 1, serialTo: null, totalElectors: null,
    },
    pages: pages.map((p) => ({
      page: p.page, pageType: p.section === "main" ? "voter_grid" : "supplement_grid", partNo, sectionHeader: "", section: p.section,
      cards: p.cards, cover: null, warnings: [], usage: { inputTokens: 0, outputTokens: 0, calls: 0 }, durationMs: 0,
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
