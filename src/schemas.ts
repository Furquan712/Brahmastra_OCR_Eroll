import { z } from "zod";

/* ---------- JSON Schemas handed to the model (all fields required; strings everywhere
   so the same schema works on Claude / OpenAI / Gemini structured output). ---------- */

const str = { type: "string" } as const;
const int = { type: "integer" } as const;

export const COVER_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    present: { type: "boolean" },
    stateHi: str, stateEn: str,
    acNo: str, acNameHi: str, acNameEn: str,
    partNo: str,
    psNoAndNameHi: str, psNameHi: str, psNameEn: str, psAddressHi: str,
    revisionType: { type: "string", enum: ["Draft", "Final", "Unknown"] },
    revisionYear: str, qualifyingDate: str, publicationDate: str,
    serialFrom: str, serialTo: str, totalElectors: str,
  },
  required: [
    "present", "stateHi", "stateEn", "acNo", "acNameHi", "acNameEn", "partNo",
    "psNoAndNameHi", "psNameHi", "psNameEn", "psAddressHi", "revisionType", "revisionYear",
    "qualifyingDate", "publicationDate", "serialFrom", "serialTo", "totalElectors",
  ],
} as const;

export const CLASSIFY_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    pageType: {
      type: "string",
      enum: ["cover", "index", "map", "voter_grid", "supplement_grid", "modification_grid", "deletion_grid", "summary", "blank", "other"],
    },
    partNo: str,
    acNo: str,
    acNameHi: str,
    sectionHeader: str,
    gridCols: int,
    gridRowsFilled: int,
    cardCount: int,
    cover: COVER_JSON_SCHEMA,
  },
  required: ["pageType", "partNo", "acNo", "acNameHi", "sectionHeader", "gridCols", "gridRowsFilled", "cardCount", "cover"],
};

export const CARD_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    serial: str,
    epicNo: str,
    nameHi: str,
    relationTypeHi: str,
    relationNameHi: str,
    houseNo: str,
    age: str,
    genderHi: str,
    deleted: { type: "string", enum: ["true", "false"] },
    confidence: { type: "number" },
    notes: str,
  },
  required: ["serial", "epicNo", "nameHi", "relationTypeHi", "relationNameHi", "houseNo", "age", "genderHi", "deleted", "confidence", "notes"],
} as const;

export const EXTRACT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { cards: { type: "array", items: CARD_JSON_SCHEMA } },
  required: ["cards"],
};

/* ---------- zod validation of what came back (lenient: coerce numbers, default strings) ---------- */

const s = z.union([z.string(), z.number()]).transform((v) => String(v ?? "").trim()).default("");

export const CoverZ = z.object({
  present: z.coerce.boolean().default(false),
  stateHi: s, stateEn: s, acNo: s, acNameHi: s, acNameEn: s, partNo: s,
  psNoAndNameHi: s, psNameHi: s, psNameEn: s, psAddressHi: s,
  revisionType: z.enum(["Draft", "Final", "Unknown"]).catch("Unknown"),
  revisionYear: s, qualifyingDate: s, publicationDate: s,
  serialFrom: s, serialTo: s, totalElectors: s,
});

export const ClassifyZ = z.object({
  pageType: z.enum(["cover", "index", "map", "voter_grid", "supplement_grid", "modification_grid", "deletion_grid", "summary", "blank", "other"]).catch("other"),
  partNo: s,
  acNo: s,
  acNameHi: s,
  sectionHeader: s,
  gridCols: z.coerce.number().int().catch(0),
  gridRowsFilled: z.coerce.number().int().catch(0),
  cardCount: z.coerce.number().int().catch(0),
  cover: CoverZ.optional(),
});
export type ClassifyOut = z.infer<typeof ClassifyZ>;

export const CardZ = z.object({
  serial: s,
  epicNo: s,
  nameHi: s,
  relationTypeHi: s,
  relationNameHi: s,
  houseNo: s,
  age: s,
  genderHi: s,
  deleted: z.union([z.string(), z.boolean()]).transform((v) => v === true || String(v).toLowerCase() === "true").default(false),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  notes: s,
});
export type CardOut = z.infer<typeof CardZ>;

export const ExtractZ = z.object({ cards: z.array(CardZ).default([]) });
export type ExtractOut = z.infer<typeof ExtractZ>;
