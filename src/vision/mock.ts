import type { VisionProvider, VisionRequest, VisionResponse } from "./types.js";

/**
 * Dev-only provider: no network. Classifies page 1 as cover, everything else as voter_grid,
 * and returns 6 synthetic cards per extraction call. Lets the whole pipeline (render, crop,
 * cache, merge, CSV, summary) be exercised without an API key. Output is NOT real data.
 */
export class MockProvider implements VisionProvider {
  readonly name = "mock";
  readonly model = "mock";
  private serial = 0;
  private pageCounter = 0;

  async call(req: VisionRequest): Promise<VisionResponse> {
    let obj: unknown;
    if (req.schemaName === "page_classification") {
      const n = ++this.pageCounter;
      const isCover = n === 1;
      obj = {
        pageType: isCover ? "cover" : n === 2 ? "map" : "voter_grid",
        partNo: "794",
        acNo: "62",
        acNameHi: "दादरी",
        sectionHeader: isCover ? "" : "अनुभाग संख्या और नाम : 1-गढ़ी समस्तपुर",
        gridCols: 3,
        gridRowsFilled: 10,
        cardCount: 30,
        cover: {
          present: isCover, stateHi: "उत्तर प्रदेश", stateEn: "Uttar Pradesh", acNo: "62", acNameHi: "दादरी", acNameEn: "Dadri",
          partNo: "794", psNoAndNameHi: "794 - प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1", psNameHi: "प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1",
          psNameEn: "Prathmik Vidyalaya Garhi Samastpur K.No. 1", psAddressHi: "प्राथमिक विद्यालय गढ़ी समस्तपुर",
          revisionType: "Final", revisionYear: "2026", qualifyingDate: "01-01-2026", publicationDate: "10-04-2026",
          serialFrom: "1", serialTo: "350", totalElectors: "350",
        },
      };
    } else if (req.schemaName === "cover_text") {
      obj = {
        present: true, stateHi: "उत्तर प्रदेश", stateEn: "Uttar Pradesh", acNo: "62", acNameHi: "दादरी", acNameEn: "",
        partNo: "794", psNoAndNameHi: "794 - प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1", psNameHi: "प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1",
        psNameEn: "", psAddressHi: "प्राथमिक विद्यालय गढ़ी समस्तपुर", revisionType: "Final", revisionYear: "2026",
        qualifyingDate: "01-01-2026", publicationDate: "10-04-2026", serialFrom: "1", serialTo: "350", totalElectors: "350",
      };
    } else {
      const cards = [];
      const m = /You are given (\d+) images/.exec(req.prompt);
      const n = m ? Number(m[1]) : /ONE voter card/.test(req.prompt) ? 1 : 6;
      for (let i = 0; i < n; i++) {
        const s = ++this.serial;
        cards.push({
          serial: String(s), epicNo: `MCK${String(1000000 + s).slice(-7)}`, nameHi: "मुनेन्दर", relationTypeHi: "पिता",
          relationNameHi: "धीर सिंह", houseNo: "00", age: String(18 + (s % 60)), genderHi: s % 2 ? "पुरुष" : "महिला",
          deleted: "false", confidence: s % 7 === 0 ? 0.5 : 0.95, notes: "",
        });
      }
      obj = { cards };
    }
    return { text: JSON.stringify(obj), inputTokens: 1000, outputTokens: 300 };
  }
}
