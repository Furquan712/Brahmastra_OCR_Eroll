import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { applyCoverMeta, buildCover, cleanMetaValue, looksLikeCover, parseCoverMetaText, parseCoverText, parseErollFilename, parseSectionList, parseSupplementHeader, titleCaseIfUpper } from "../src/cover.js";
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
  assert.ok(looksLikeCover(TEXT));
});

// Tesseract (eng, psm 4) of the Goa part 1 cover, verbatim: an English roll.
const GOA = `ELECTORAL ROLL 2026 S05 Goa

No. Name and Reservation Status of Assembly Constituency : 26 - DABOLIM (GEN) Part No.:1

No. Name and Reservation Status of Parliamentary Constituency(ies) in which the Assembly Constituency is located : 2 - SOUTH
GOA (GEN)

1. Details of Revision

Year of Revision 2026 Roll Identification
Integrated Electoral Roll based on the Draft Roll of Special Intensive Revision
Qualifying Date 01-01-2026 2026 published on 16-12-2025 and integrated with Additions, Deletions and
.. . . . Modifications carried out during Special Intensive Revision 2026
Type of revision Special Intensive Revision
2026
Date of Updation 21-02-2026

2. Details of part and polling area

No. and name of sections in the part

1-Near Sohia Pay Phone, New Vaddem

9 Main Town or Village : VASCO-DA-GAMA
Nan Last Bus Stop, New Vaddem Post Office : VASCO-DA-GAMA
Nee Aslam Bakery, New Vaddem Police Station : VASCO
een Bore Well, New Vaddem Block : MORMUGAO
ave nee ae a Vaddem Subdivision : MORMUGAO

-Near Gajeshri Vidhalaya, New Vaddem District : SOUTH GOA

Pin code : 403802

3. Polling station details
No. and Name of Polling Station : Type of Polling Station General

(Male/Female/General)

1 - Vaddemnagar English High School, New Vaddem,
Vasco-da-Gama (Room No. 1) Number of Auxiliary Polling 0
Stations in this part:

Address of Polling Station :

Vaddemnagar English High School, New Vaddem,
Vasco-da-Gama

4. NUMBER OF ELECTORS

Starting Ending Net Electors
Serial No. Serial No. Male Female Third Gender Total
1 875 371 351 0 722

Signature of Electoral Registration Officer

Total Pages 37 - Page 1`;

test("parseCoverText reads an English (Goa) cover: identifiers, station, address, counts, metadata, sections", () => {
  const { fields: f, sections, missing } = parseCoverText(GOA);
  assert.equal(f.stateEn, "Goa");
  assert.equal(f.acNo, "26");
  assert.equal(f.acNameHi, "DABOLIM");
  assert.equal(f.partNo, "1");
  assert.equal(f.revisionYear, "2026");
  assert.equal(f.revisionType, "Final");
  assert.equal(f.qualifyingDate, "01-01-2026");
  assert.equal(f.publicationDate, "21-02-2026");
  assert.equal(f.psNameHi, "Vaddemnagar English High School, New Vaddem, Vasco-da-Gama (Room No. 1)");
  assert.equal(f.psNoAndNameHi, "1 - Vaddemnagar English High School, New Vaddem, Vasco-da-Gama (Room No. 1)");
  assert.equal(f.psAddressHi, "Vaddemnagar English High School, New Vaddem, Vasco-da-Gama");
  assert.equal(f.serialFrom, "1");
  assert.equal(f.serialTo, "875");
  assert.equal(f.totalElectors, "722");
  assert.equal(f.mainTownVillageHi, "VASCO-DA-GAMA");
  assert.equal(f.postOfficeHi, "VASCO-DA-GAMA");
  assert.equal(f.policeStationHi, "VASCO");
  assert.equal(f.blockHi, "MORMUGAO");
  assert.equal(f.tehsilHi, "MORMUGAO"); // "Subdivision"
  assert.equal(f.districtHi, "SOUTH GOA");
  assert.equal(f.pinCode, "403802");
  assert.deepEqual(sections?.[0], { no: "1", name: "Near Sohia Pay Phone, New Vaddem" });
  assert.deepEqual(missing, []);
  assert.ok(looksLikeCover(GOA));

  const translit = new Transliterator(fs.mkdtempSync(path.join(os.tmpdir(), "cover-")));
  const { cover } = buildCover(parseCoverText(GOA), null, parseErollFilename("AC026_SIR-FinalRoll_part_0001.pdf"), translit, "x.pdf");
  assert.equal(cover.acNameHi, "");
  assert.equal(cover.acNameEn, "Dabolim");
  assert.equal(cover.psNameHi, "");
  assert.equal(cover.psNameEn, "Vaddemnagar English High School, New Vaddem, Vasco-da-Gama (Room No. 1)");
  assert.equal(cover.districtEn, "South Goa");
  assert.equal(cover.mainTownVillageEn, "Vasco-Da-Gama");
  assert.equal(cover.tehsilEn, "Mormugao");
  assert.equal(cover.pinCode, "403802");
  assert.equal(cover.sections[0].nameEn, "Near Sohia Pay Phone, New Vaddem");
  assert.equal(cover.supplementNo, "");
});

test("parseSectionList reads the cover's section list, wrapped names included", () => {
  assert.deepEqual(parseSectionList("1-कामबक्शपुर\n2-गुरजा डेरीन कामबक्शपुर\n3-पंडित डेरीन\nकामबक्शपुर"), [
    { no: "1", name: "कामबक्शपुर" }, { no: "2", name: "गुरजा डेरीन कामबक्शपुर" }, { no: "3", name: "पंडित डेरीन कामबक्शपुर" },
  ]);
  assert.deepEqual(parseSectionList("1-Near Sohia Pay Phone, New Vaddem\n2 - Near Last Bus Stop, New Vaddem\nPost Office : VASCO"), [
    { no: "1", name: "Near Sohia Pay Phone, New Vaddem" }, { no: "2", name: "Near Last Bus Stop, New Vaddem" },
  ]);
});

test("a separately published supplement has no cover: its header gives the identifiers", () => {
  const hdr = "Supplement 2\nList of Addition, Deletion and Modification carried out during Continuous Updation with respect to Ist April 2026\nAssembly Constituency No and Name : 26-DABOLIM Part No. :17\n2- List of Deletions";
  assert.ok(!looksLikeCover(hdr));
  assert.deepEqual(parseSupplementHeader(hdr), { supplementNo: "2", acNo: "26", acNameHi: "DABOLIM", partNo: "17", revisionYear: "2026" });
  const hi = "निर्वाचक नामावली -2026 ,विधानसभा निर्वाचन क्षेत्र: : 62-दादरी भाग संख्या : : 793\nपरिवर्धन की सूची 1 (06-01-2026 01-04-2026 )";
  const p = parseSupplementHeader(hi);
  assert.equal(p.acNo, "62");
  assert.equal(p.acNameHi, "दादरी");
  assert.equal(p.partNo, "793");
  const translit = new Transliterator(fs.mkdtempSync(path.join(os.tmpdir(), "cover-")));
  const { cover } = buildCover({ fields: parseSupplementHeader(hdr), sections: [], missing: [] }, null, parseErollFilename("2026-SUPPLEMENTGEN-S05-26-2-all_together-ENG-17-WI.pdf"), translit, "s.pdf");
  assert.equal(cover.supplementNo, "2");
  assert.equal(cover.partNo, "17");
  assert.equal(cover.acNameEn, "Dabolim");
  assert.equal(cover.stateEn, "Goa");
  assert.equal(titleCaseIfUpper("SOUTH GOA"), "South Goa");
  assert.equal(titleCaseIfUpper("Vasco-da-Gama"), "Vasco-da-Gama");
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
    year: "2026", stateCode: "S24", acNo: "62", type: "Final", partNo: "794", supplementNo: "",
  });
  assert.deepEqual(parseErollFilename("2026-SUPPLEMENTGEN-S05-26-2-all_together-ENG-17-WI.pdf"), {
    year: "2026", stateCode: "S05", acNo: "26", type: "Unknown", partNo: "17", supplementNo: "2",
  });
  assert.deepEqual(parseErollFilename("AC026_SIR-FinalRoll_part_0001.pdf"), {
    year: "", stateCode: "", acNo: "26", type: "Final", partNo: "1", supplementNo: "",
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
