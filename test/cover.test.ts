import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyCoverMeta, buildCover, cleanMetaValue, parseCoverMetaText, parseCoverText, parseErollFilename } from "../src/cover.js";
import { Transliterator } from "../src/translit.js";

// Tesseract (eng+hin, psm 4) output of the Dadri part 794 cover, verbatim including its errors.
const TEXT = `निर्वाचक नामावली 2026 $24 उत्तर प्रदेश

विधानसभा निर्वाचन क्षेत्र की संख्या व नाम और आरक्षण स्थिति : 62 - दादरी (सामान्य) भाग संख्या : : 794

संसदीय निर्वाचन क्षेत्र की संख्या व नाम और आरक्षण स्थिति जिसमें विधानसभा निर्वाचन क्षेत्र स्थित है : 13 - गौतम बुद्ध नगर (सामान्य)

1. पुनरीक्षण का विवरण

पुनरीक्षण का वर्ष : 2026 निर्वाचक नामावली की पहचान :
विशेष गहन पुनरीक्षण 2026 की एकीकृत अंतिम मूल निर्वाचक नामावली
agar तिथि : 01-01-2026
पुनरीक्षण का प्रकार : विशेष गहन पुनरीक्षण 2026
प्रकाशन की तिथि : 10-04-2026

2. भाग और मतदान क्षेत्र का विवरण :

भाग में अनुभागों की संख्या और नाम :
1-गढ़ी समस्तपुर _ कस्बा अथवा ग्राम : नोएडा औद्योगिक विकास प्राधिकरण
वार्ड : नोएडा औद्योगिक विकास प्राधिकरण
डाकघर > कासना
थाना : नॉलेज पार्क प्रथम
पंचायत :
ब्लॉक :
तहसील : गौतमबुद्धनगर
जिला : गौतम बुद्ध नगर
पिन कोड : 201308
3. मतदान स्थल का विवरण
naa cae की संख्या और नाम: मतदान स्थल के प्रकार (पुरुष / महिला / सामान्य) : Same
794 - प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1 इस भाग में सहायक मतदान स्थलों की व
संख्या :
मतदान स्थल का पता :
प्राथमिक विद्यालय गढी समस्तपुर
4. निर्वाचकों की संख्या :
प्रारम्भिक क्रम अंतिम क्रम ee | मतदाता
संख्या संख्या |... पुरुष... | महिला तृतीय लिंग |... कुल... |
1 350 181 pe | |... ०... | 350
निर्वाचक रजिस्ट्रीकरण अधिकारी

कुल पृष्ठ 16 - पृष्ठ 1`;

test("parseCoverText reads the assembly (not the parliamentary) seat, part, dates, station and counts", () => {
  const { fields: f, missing } = parseCoverText(TEXT);
  assert.equal(f.stateEn, "Uttar Pradesh");
  assert.equal(f.stateHi, "उत्तर प्रदेश");
  assert.equal(f.acNo, "62");
  assert.equal(f.acNameHi, "दादरी");
  assert.equal(f.partNo, "794");
  assert.equal(f.revisionYear, "2026");
  assert.equal(f.revisionType, "Final");
  assert.equal(f.qualifyingDate, "01-01-2026");
  assert.equal(f.publicationDate, "10-04-2026");
  assert.equal(f.psNameHi, "प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1");
  assert.equal(f.psNoAndNameHi, "794 - प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1");
  assert.equal(f.psAddressHi, "प्राथमिक विद्यालय गढी समस्तपुर");
  assert.equal(f.serialFrom, "1");
  assert.equal(f.serialTo, "350");
  assert.equal(f.totalElectors, "350");
  assert.deepEqual(missing, []);
  // Section 2: town / ward / post office / police station / panchayat / block / tehsil / district / pin.
  assert.equal(f.mainTownVillageHi, "नोएडा औद्योगिक विकास प्राधिकरण");
  assert.equal(f.wardHi, "नोएडा औद्योगिक विकास प्राधिकरण");
  assert.equal(f.postOfficeHi, "कासना");
  assert.equal(f.policeStationHi, "नॉलेज पार्क प्रथम");
  assert.equal(f.panchayatHi, "");
  assert.equal(f.blockHi, "");
  assert.equal(f.tehsilHi, "गौतमबुद्धनगर");
  assert.equal(f.districtHi, "गौतम बुद्ध नगर");
  assert.equal(f.pinCode, "201308");
});

test("parseCoverMetaText survives left-column junk, missing colons and OCR'd labels", () => {
  const f = parseCoverMetaText(`हू ही. कस्बा अथवा ग्राम : नोएडा औद्योगिक विकास प्राधिकरण
3 हर fea 28a कामबक्शपुर वार्ड : नोएडा औद्योगिक विकास प्राधिकरण
डाकघर > कासना
थाना : नॉलेज पार्क प्रथम
पंचायत
ब्लॉक :
तहसील : गौतमबुद्धनगर
जिला : गौतम बुद्ध नगर
पिन कोड : 2013 08`);
  assert.equal(f.mainTownVillageHi, "नोएडा औद्योगिक विकास प्राधिकरण");
  assert.equal(f.wardHi, "नोएडा औद्योगिक विकास प्राधिकरण");
  assert.equal(f.postOfficeHi, "कासना");
  assert.equal(f.panchayatHi, "");
  assert.equal(f.blockHi, "");
  assert.equal(f.pinCode, "201308");
  assert.equal(parseCoverMetaText("पिन कोड : 20308").pinCode, undefined); // 5 digits: not a pin
  assert.equal(cleanMetaValue(" | नॉलेज पार्क_ प्रथम ,"), "नॉलेज पार्क प्रथम");
});

test("applyCoverMeta lets the box re-read and the digit-only pin read override the page text", () => {
  const regex = parseCoverText(TEXT.replace("पिन कोड : 201308", "पिन कोड : 207308").replace("डाकघर > कासना", "पं न Zam : कासना"));
  assert.equal(regex.fields.pinCode, "207308");
  assert.equal(regex.fields.postOfficeHi, undefined);
  const a = applyCoverMeta(regex, { text: "", metaText: "डाकघर : कासना\nपंचायत :\nपिन कोड : 20308", pinCode: "201308" });
  assert.equal(a.fields.postOfficeHi, "कासना");
  assert.equal(a.fields.panchayatHi, "");
  assert.equal(a.fields.pinCode, "201308"); // digit pass wins over both text reads
  const b = applyCoverMeta(regex, { text: "", metaText: "", pinCode: "" });
  assert.equal(b.fields.pinCode, "207308"); // nothing better: the page text stands
});

test("parseCoverText tolerates a draft roll and missing pieces", () => {
  const { fields, missing } = parseCoverText("निर्वाचक नामावली 2025 S04 बिहार\nप्रारूप निर्वाचक नामावली\nभाग संख्या : 12");
  assert.equal(fields.stateEn, "Bihar");
  assert.equal(fields.revisionType, "Draft");
  assert.equal(fields.partNo, "12");
  assert.ok(missing.includes("acNo"));
});

test("parseErollFilename", () => {
  assert.deepEqual(parseErollFilename("2026-EROLLGEN-S24-62-SIR-FinalRoll-Revision1-HIN-794-WI.pdf"), {
    year: "2026", stateCode: "S24", acNo: "62", type: "Final", partNo: "794",
  });
  assert.equal(parseErollFilename("part-794.pdf"), null);
});

test("buildCover merges text, model and file name with warnings on disagreement", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cover-"));
  const translit = new Transliterator(dir);
  const regex = parseCoverText(TEXT);
  const fn = parseErollFilename("2026-EROLLGEN-S24-62-SIR-FinalRoll-Revision1-HIN-794-WI.pdf");

  const a = buildCover(regex, null, fn, translit, "x.pdf");
  assert.equal(a.cover.acNo, "62");
  assert.equal(a.cover.acNameEn, "Dadri");
  assert.ok(a.cover.psNameEn.startsWith("Prathmik Vidyalay Garhi"), a.cover.psNameEn);
  assert.equal(a.cover.serialTo, 350);
  assert.deepEqual(a.warnings, []);
  assert.equal(a.cover.pinCode, "201308");
  assert.equal(a.cover.districtHi, "गौतम बुद्ध नगर");
  assert.ok(a.cover.districtEn.length > 0);
  assert.equal(a.cover.panchayatHi, "");
  assert.equal(a.cover.panchayatEn, "");
  assert.ok(a.cover.psAddressEn.startsWith("Prathmik Vidyalay"), a.cover.psAddressEn);

  // A model read that disagrees is kept but reported; a model read of "" falls back to text.
  const model = { present: true, acNo: "13", acNameHi: "गौतम बुद्ध नगर", partNo: "", psNameHi: "", stateHi: "", stateEn: "", acNameEn: "", psNoAndNameHi: "", psNameEn: "", psAddressHi: "", revisionType: "Unknown" as const, revisionYear: "", qualifyingDate: "", publicationDate: "", serialFrom: "", serialTo: "", totalElectors: "" };
  const b = buildCover(regex, model, fn, translit, "x.pdf");
  assert.equal(b.cover.acNo, "13");
  assert.equal(b.cover.partNo, "794");
  assert.ok(b.warnings.some((w) => /acNo: model "13" != text "62"/.test(w)));
  assert.ok(b.warnings.some((w) => /cover AC no 13 != file name AC no 62/.test(w)));

  // Nothing readable: the file name supplies the identifiers.
  const c = buildCover(parseCoverText(""), null, fn, translit, "x.pdf");
  assert.equal(c.cover.acNo, "62");
  assert.equal(c.cover.partNo, "794");
  assert.equal(c.cover.revisionType, "Final");
  assert.equal(c.cover.stateEn, "Uttar Pradesh");
});
