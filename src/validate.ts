import { epicMatches, normalizeEpic } from "./normalize.js";
import type { Template } from "./templates.js";
import type { VoterCard } from "./types.js";

export interface RowFlagsInput {
  card: VoterCard;
  rawEpic: string;
  tpl: Template;
  confidenceThreshold: number;
  prevSerial: number | null; // previous card's serial in the same section, or null
  partNoMismatch: boolean;
  partNoMissing: boolean;
}

/** Returns flag codes for one card. Never drops the row; the caller writes it with these flags. */
export function cardFlags(i: RowFlagsInput): string[] {
  const f: string[] = [];
  const c = i.card;
  if (!c.epicNo) f.push("epic_missing");
  else if (!epicMatches(c.epicNo, i.tpl)) f.push("epic_invalid");
  if (c.epicNo && normalizeEpic(i.rawEpic).corrected) f.push("epic_autocorrected");
  if (!c.nameHi && !c.nameEn) f.push("name_missing");
  else if (!c.nameEn) f.push("name_en_missing");
  else if (!c.nameHi) f.push("name_hi_missing");
  if (c.age === null) f.push("age_missing");
  else if (c.age < 0 || c.age > 120 || !Number.isInteger(c.age)) f.push("age_out_of_range");
  else if (c.age < 18) f.push("age_under_18");
  if (c.relationTypeHi && !c.relationType) f.push("relation_unknown");
  if (!c.genderEn) f.push("gender_unknown");
  if (c.confidence < i.confidenceThreshold) f.push("low_confidence");
  if (c.serial === null) f.push("serial_missing");
  else if (i.prevSerial !== null && c.serial !== i.prevSerial + 1) f.push("serial_gap");
  if (c.deleted) f.push("deleted_stamp");
  if (i.partNoMissing) f.push("part_no_missing");
  else if (i.partNoMismatch) f.push("part_no_mismatch");
  return f;
}
