import type { Template } from "./templates.js";

export function systemPrompt(tpl: Template): string {
  return [
    "You are a meticulous data-entry operator digitising scanned Indian electoral rolls (ECI eRoll PDFs).",
    `The documents are printed in ${tpl.language}. EPIC (voter ID) numbers are always Latin letters and digits.`,
    "You read small dense print exactly as printed. You never invent values: if a field is unreadable you return an empty string and lower the confidence.",
    "You always answer with a single JSON object that matches the requested schema and nothing else.",
  ].join(" ");
}

export const PAGE_TYPES_DOC = `
- "cover": the first page - title, state, assembly constituency (विधानसभा निर्वाचन क्षेत्र) number & name, भाग संख्या (part number), revision details (पुनरीक्षण), polling station (मतदान स्थल) number/name/address, elector counts table.
- "index": an index / table of sections.
- "map": page showing maps / photographs of the polling station.
- "voter_grid": the main electoral roll - a grid of bordered voter cards; the sub-header starts with "अनुभाग संख्या और नाम".
- "supplement_grid": additions list - same card grid, sub-header contains "परिवर्धन की सूची" or "पूरक".
- "modification_grid": corrections list - same card grid, sub-header contains "संशोधन की सूची".
- "deletion_grid": deletions list - card grid where cards are stamped DELETED / sub-header contains "विलोपन की सूची". These are NOT current voters.
- "summary": the final reconciliation table "निर्वाचकों का सार" with counts of मूल नामावली / परिवर्धन / विलोपन.
- "blank": no meaningful content.
- "other": anything else.`;

export function classifyPrompt(tpl: Template): string {
  return `Classify this page of an electoral roll PDF and read its header.

Page types:${PAGE_TYPES_DOC}

Return JSON with:
- pageType: one of the types above.
- partNo: the part number printed in the page header after "भाग संख्या" (digits only, e.g. "794"). "" if absent.
- acNo: the assembly constituency number from the header (digits only). "" if absent.
- acNameHi: the assembly constituency name as printed (Devanagari). "" if absent.
- sectionHeader: the full text of the second header line (e.g. "अनुभाग संख्या और नाम : 1-गढ़ी समस्तपुर" or "परिवर्धन की सूची 1 (06-01-2026 01-04-2026)"). "" if none.
- gridCols: number of card columns on a grid page (0 if not a grid page). Expected ${tpl.grid.cols}.
- gridRowsFilled: number of card rows that contain at least one card (0 if not a grid page). Max ${tpl.grid.rows}.
- cardCount: total voter cards visible (0 if not a grid page).
- cover: fill ONLY for pageType "cover" (otherwise set present=false and leave other fields ""):
  - present: true
  - stateHi / stateEn: state name in Devanagari and its standard English name (e.g. "उत्तर प्रदेश" -> "Uttar Pradesh").
  - acNo, acNameHi, acNameEn: assembly constituency number, name (Devanagari), and its phonetic English transliteration.
  - partNo: भाग संख्या.
  - psNoAndNameHi: the full "मतदान स्थल की संख्या और नाम" value as printed (e.g. "794 - प्राथमिक विद्यालय गढ़ी समस्तपुर क.नं. 1").
  - psNameHi: the polling-station name only, without the leading number and dash.
  - psNameEn: phonetic English transliteration of psNameHi (e.g. "Prathmik Vidyalaya Garhi Samastpur K.No. 1"). Transliterate sounds; do not translate meanings.
  - psAddressHi: "मतदान स्थल का पता" value.
  - revisionType: "Final" if the roll identity mentions अंतिम (final) or the title says Final; "Draft" if it mentions प्रारूप / draft; else "Unknown".
  - revisionYear: पुनरीक्षण का वर्ष (4 digits), or the year in the title.
  - qualifyingDate: अर्हता तिथि as printed.
  - publicationDate: प्रकाशन की तिथि as printed.
  - serialFrom / serialTo / totalElectors: from the "निर्वाचकों की संख्या" table (प्रारम्भिक क्रम संख्या, अंतिम क्रम संख्या, कुल) as digit strings; "" if absent.`;
}

export function extractPrompt(tpl: Template, opts: { rows: number; cols: number; what: "strip" | "page" | "card" | "cards"; count?: number }): string {
  const scope =
    opts.what === "cards"
      ? `You are given ${opts.count} images. Each image is exactly ONE voter card. Return exactly ${opts.count} cards, in the same order as the images (image 1 -> card 1, image 2 -> card 2, ...). Never merge, skip, or reorder.`
      : opts.what === "card"
      ? "This image is ONE voter card."
      : opts.what === "page"
        ? `This image is a full page of the voter card grid: up to ${opts.rows} rows x ${opts.cols} columns of bordered cards (the last row may be partially filled).`
        : `This image is a horizontal strip of the voter card grid: up to ${opts.rows} rows x ${opts.cols} columns of bordered cards (the last row may be partially filled).`;
  return `${scope}
Read EVERY card, left to right then top to bottom, and return them in that order.

Card layout: ${tpl.promptNotes}
Field labels used: name=${tpl.labels.name?.join("/")}; father=${tpl.labels.father?.join("/")}; husband=${tpl.labels.husband?.join("/")}; mother=${tpl.labels.mother?.join("/")}; house=${tpl.labels.house?.join("/")}; age=${tpl.labels.age?.join("/")}; gender=${tpl.labels.gender?.join("/")}.

For each card return:
- serial: the serial number in the small box at the top-left (digits as a string).
- epicNo: the EPIC/voter-ID number at the top-right, EXACTLY as printed, uppercase, keep slashes. Formats look like "NDT3366283" (3 letters + 7 digits) or "UP/77/387/1005191". Do not confuse letter O with digit 0: after the first 3 letters everything is digits.
- nameHi: elector's name in Devanagari exactly as printed after the "${tpl.labels.name?.[0]}" label.
- relationTypeHi: the relation label exactly as printed, one of: ${Object.keys(tpl.relationMap).filter((k) => /[ऀ-ॿ]/.test(k) && !/ /.test(k)).join(", ")}. Use "" if no relation line exists.
- relationNameHi: the relation person's name in Devanagari exactly as printed.
- houseNo: the house number value as printed (may be letters, digits, Devanagari, "0", or "").
- age: digits as a string.
- genderHi: the gender word exactly as printed (${Object.keys(tpl.genderMap).filter((k) => /[ऀ-ॿ]/.test(k)).join(", ")}).
- deleted: "true" if the card is overprinted/stamped with DELETED, विलोपित, or similar, else "false".
- confidence: your confidence 0.0-1.0 that ALL fields of this card are read correctly (lower it for smudged or ambiguous characters).
- notes: short note on anything ambiguous, else "".

Copy Devanagari exactly as printed, including nukta dots and conjuncts. Do not transliterate or translate anything.

Return JSON: {"cards":[...]}. Include every card visible. Do not skip, merge, or reorder cards. If the image contains no cards, return {"cards":[]}.`;
}
