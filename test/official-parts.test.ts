import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parts-"));
process.env.OCR_PARTS_DIR = dir;
const { ensureOfficialParts, officialPartName, officialPartCount, sameAcName } = await import("../src/official-parts.js");

const log = { info() {}, warn() {}, error() {}, debug() {} } as never;
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function portal(calls: string[] = []) {
  globalThis.fetch = (async (url: string) => {
    const u = String(url);
    calls.push(u);
    const json = (x: unknown) => new Response(JSON.stringify(x), { status: 200 });
    if (u.endsWith("/common/districts/S28")) return json([{ districtCd: "S2812" }, { districtCd: "S2804" }]);
    if (u.endsWith("/common/acs/S2812")) return json([{ asmblyNo: 41, asmblyName: "Kotdwar" }]);
    if (u.endsWith("/common/acs/S2804")) return json([{ asmblyNo: 68, asmblyName: "Sitarganj" }]);
    if (u.endsWith("/printing-publish/get-part-list")) return json({ payload: [{ partNumber: 2, partName: " BETA  SCHOOL " }, { partNumber: 1, partName: "ALPHA" }, { partNumber: 4, partName: "" }] });
    return new Response("nope", { status: 404 });
  }) as typeof fetch;
}

test("a missing list is fetched from the portal, by the AC's real district", async () => {
  const calls: string[] = [];
  portal(calls);
  const f = await ensureOfficialParts("S28", "68", log);
  assert.equal(f?.acName, "Sitarganj");
  assert.ok(calls.some((u) => u.endsWith("/common/acs/S2804")));
  assert.equal(officialPartName("S28", "68", "2"), "BETA SCHOOL");
  assert.equal(officialPartName("S28", "68", "4"), null);
  assert.equal(officialPartCount("S28", "68"), 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "S28-68.json"), "utf8")).gaps, [3]);
});

test("a list on file is not fetched again", async () => {
  const calls: string[] = [];
  portal(calls);
  await ensureOfficialParts("S28", "68", log);
  assert.equal(calls.length, 0);
});

test("a portal failure returns no list, is not retried at once, and never throws", async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (u: string) => { calls.push(String(u)); throw new Error("down"); }) as typeof fetch;
  assert.equal(await ensureOfficialParts("S28", "1", log), null);
  const n = calls.length;
  assert.equal(await ensureOfficialParts("S28", "1", log), null);
  assert.equal(calls.length, n);
});

test("a list that arrives after a miss is picked up without a restart", () => {
  assert.equal(officialPartName("S28", "2", "1"), null);
  fs.writeFileSync(path.join(dir, "S28-2.json"), JSON.stringify({ acName: "X", count: 1, maxPart: 1, parts: [{ partNumber: 1, partName: "LATE" }] }));
  assert.equal(officialPartName("S28", "2", "1"), "LATE");
});

test("sameAcName catches a wrong AC but allows spelling variants", () => {
  assert.equal(sameAcName("Sitarganj", "Kotdwar"), false);
  assert.equal(sameAcName("Agra North", "Agra South"), false);
  assert.equal(sameAcName("Goverdhan", "Govardhan"), true);
  assert.equal(sameAcName("Bishwavnathganj", "Vishwanath Ganj"), true);
  assert.equal(sameAcName("Domariyaganj", "Doomariyaganj"), true);
  assert.equal(sameAcName("Mohanlalganj (SC)", "Mohanlalganj"), true);
  assert.equal(sameAcName("Powayan (SC)", "Powayan(SC)"), true);
  assert.equal(sameAcName("Agra Cantt.", "Agra Cantt"), true);
  assert.equal(sameAcName("", "Kotdwar"), true);
});
