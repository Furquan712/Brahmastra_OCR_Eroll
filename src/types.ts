/** Shared data shapes for the pipeline. */

export type PageType =
  | "cover"
  | "index"
  | "map"
  | "voter_grid"
  | "supplement_grid"
  | "modification_grid"
  | "deletion_grid"
  | "summary"
  | "blank"
  | "other";

/** Page types whose cards become voter rows. */
export const VOTER_PAGE_TYPES: ReadonlySet<PageType> = new Set([
  "voter_grid",
  "supplement_grid",
  "modification_grid",
]);

export interface CoverInfo {
  stateHi: string;
  stateEn: string;
  acNo: string;
  acNameHi: string;
  acNameEn: string;
  partNo: string;
  psNoAndNameHi: string;
  psNameHi: string;
  psNameEn: string;
  psAddressHi: string;
  psAddressEn: string;
  /** Section 2 of the cover: "भाग और मतदान क्षेत्र का विवरण" (administrative location of the part). */
  mainTownVillageHi: string; // मुख्य कस्बा अथवा ग्राम
  mainTownVillageEn: string;
  wardHi: string; // वार्ड
  wardEn: string;
  postOfficeHi: string; // डाकघर
  postOfficeEn: string;
  policeStationHi: string; // थाना
  policeStationEn: string;
  panchayatHi: string; // पंचायत
  panchayatEn: string;
  blockHi: string; // ब्लॉक
  blockEn: string;
  tehsilHi: string; // तहसील
  tehsilEn: string;
  districtHi: string; // जिला
  districtEn: string;
  pinCode: string; // पिन कोड, 6 digits
  revisionType: "Draft" | "Final" | "Unknown";
  revisionYear: string;
  qualifyingDate: string;
  publicationDate: string;
  serialFrom: number | null;
  serialTo: number | null;
  totalElectors: number | null;
}

export interface PageClassification {
  pageType: PageType;
  partNo: string;
  acNo: string;
  acNameHi: string;
  sectionHeader: string;
  gridCols: number;
  gridRowsFilled: number;
  cardCount: number;
  cover: CoverInfo | null;
}

/** One voter card exactly as the model returned it (after light normalization). */
export interface VoterCard {
  serial: number | null;
  epicNo: string;
  nameHi: string;
  nameEn: string;
  relationTypeHi: string;
  relationType: string; // Father | Husband | Mother | Other | ""
  relationNameHi: string;
  relationNameEn: string;
  houseNo: string;
  age: number | null;
  genderHi: string;
  genderEn: string; // Male | Female | Other | ""
  confidence: number; // 0..1 (model self-reported, or tesseract min word conf / 100)
  notes: string;
  deleted?: boolean;
  /** Which engine produced the Hindi fields. */
  engine?: "tesseract" | "llm";
  /** Why the local read was escalated to the model (hybrid engine). */
  escalated?: string[];
  /** Extra QA flags raised during extraction (e.g. serial_corrected, name_hi_corrected). */
  extraFlags?: string[];
  /** Per-field read confidence 0..1 (local engine), used by name consensus. */
  fieldConf?: { name: number; relationName: number };
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface PageResult {
  /** Set by the result cache; a cached page without the current version is ignored. */
  schemaVersion?: number;
  page: number;
  pageType: PageType;
  partNo: string;
  sectionHeader: string;
  section: "main" | "supplement" | "modification" | "deletion" | "none";
  cards: VoterCard[];
  /** Page number printed in the footer ("कुल पृष्ठ 42 - पृष्ठ 40" -> 40); null when not read. */
  printedPage?: number | null;
  /** Total page count printed in the footer; null when not read. */
  printedTotal?: number | null;
  /** EPICs exactly as the model returned them (parallel to cards) - used to flag auto-corrections. */
  rawEpics?: string[];
  cover: CoverInfo | null;
  warnings: string[];
  usage: Usage;
  durationMs: number;
}

export interface PdfResult {
  schemaVersion: number;
  file: string; // basename
  hash: string;
  template: string;
  provider: string;
  model: string;
  pageCount: number;
  partNo: string;
  cover: CoverInfo | null;
  pages: PageResult[];
  status: "ok" | "failed";
  error?: string;
  startedAt: string;
  finishedAt: string;
  usage: Usage;
}

/** One CSV row. Key order == column order. */
export interface OutputRow {
  PS_name_eg: string;
  PS_name_hi: string;
  Part_no: string;
  Epic_no: string;
  Name_eg: string;
  Name_hi: string;
  Relation_type_eg: string;
  Relation_type_hi: string;
  Relation_name_eg: string;
  Relation_name_hi: string;
  house_no: string;
  age: string;
  Gender_eg: string;
  Gender_hi: string;
  /** Serial number printed on the card (क्रम संख्या). */
  Serial_no: string;
  /** Page number printed in the page footer (falls back to the PDF page index). */
  Page_no: string;
  Section: string;
  State: string;
  AC_no: string;
  AC_name_eg: string;
  AC_name_hi: string;
  Main_town_village_eg: string;
  Main_town_village_hi: string;
  Ward_eg: string;
  Ward_hi: string;
  Post_office_eg: string;
  Post_office_hi: string;
  Police_station_eg: string;
  Police_station_hi: string;
  Panchayat_eg: string;
  Panchayat_hi: string;
  Block_eg: string;
  Block_hi: string;
  Tehsil_eg: string;
  Tehsil_hi: string;
  District_eg: string;
  District_hi: string;
  Pin_code: string;
  PS_address_eg: string;
  PS_address_hi: string;
  Roll_type: string;
  Roll_year: string;
  _source_pdf: string;
  _page: string;
  _ocr_confidence: string;
  _ocr_engine: string;
  _flag_reason: string;
}

export const CSV_COLUMNS: (keyof OutputRow)[] = [
  "PS_name_eg",
  "PS_name_hi",
  "Part_no",
  "Epic_no",
  "Name_eg",
  "Name_hi",
  "Relation_type_eg",
  "Relation_type_hi",
  "Relation_name_eg",
  "Relation_name_hi",
  "house_no",
  "age",
  "Gender_eg",
  "Gender_hi",
  "Serial_no",
  "Page_no",
  "Section",
  "State",
  "AC_no",
  "AC_name_eg",
  "AC_name_hi",
  "Main_town_village_eg",
  "Main_town_village_hi",
  "Ward_eg",
  "Ward_hi",
  "Post_office_eg",
  "Post_office_hi",
  "Police_station_eg",
  "Police_station_hi",
  "Panchayat_eg",
  "Panchayat_hi",
  "Block_eg",
  "Block_hi",
  "Tehsil_eg",
  "Tehsil_hi",
  "District_eg",
  "District_hi",
  "Pin_code",
  "PS_address_eg",
  "PS_address_hi",
  "Roll_type",
  "Roll_year",
  "_source_pdf",
  "_page",
  "_ocr_confidence",
  "_ocr_engine",
  "_flag_reason",
];

export interface ConstituencyInfo {
  folder: string; // absolute path
  state: string;
  acNo: string;
  acName: string;
  year: string;
  type: string; // Draft | Final
  parsed: boolean; // false if folder name did not match the convention
}
