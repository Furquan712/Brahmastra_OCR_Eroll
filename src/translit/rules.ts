/**
 * Rule layer: for every unit, the Roman spellings it may take ("alternatives") and which one the
 * rules prefer by default. The rules encode how names are romanised on Indian government
 * documents (no diacritics; "sh", "chh", "kh"; schwa deletion as spoken). The model in model.ts
 * re-ranks these alternatives from data; it can never produce a spelling the rules do not allow.
 */
import { clusterKey, type Consonant, type Unit } from "./devanagari.js";

/** One alignable piece of a unit: its consonant cluster, its vowel, or its nasal/visarga mark. */
export interface Slot {
  /** "C:<cluster>" | "V:<vowel>" (V:a = inherent) | "N:ं" | "H:ः" | "X:<literal>" */
  key: string;
  kind: "C" | "V" | "N" | "H" | "X";
  alts: string[];
  /** Index into alts the rules prefer. */
  dflt: number;
  unitIndex: number;
}

const CONS: Record<string, string[]> = {
  क: ["k", "c", "q"], ख: ["kh"], ग: ["g"], घ: ["gh"], ङ: ["ng", "n"],
  च: ["ch", "c"], छ: ["chh", "ch"], ज: ["j", "z"], झ: ["jh", "z"], ञ: ["n", "ny"],
  ट: ["t"], ठ: ["th"], ड: ["d"], ढ: ["dh"], ण: ["n"],
  त: ["t", "th"], थ: ["th"], द: ["d"], ध: ["dh"], न: ["n"],
  // फ without nukta is overwhelmingly an "f" name on these rolls (Arif, Asif, Irfan); Phool etc. come from data.
  प: ["p"], फ: ["f", "ph"], ब: ["b"], भ: ["bh"], म: ["m"],
  य: ["y", "i", ""], र: ["r"], ल: ["l"], ळ: ["l"], व: ["v", "w"],
  श: ["sh", "s"], ष: ["sh", "s"], स: ["s"], ह: ["h"],
};

const CONS_NUKTA: Record<string, string[]> = {
  क: ["q", "k"], ख: ["kh"], ग: ["gh", "g"], ज: ["z", "j"], ड: ["r", "d"], ढ: ["rh", "dh"], फ: ["f", "ph"],
  य: ["y"], न: ["n"], र: ["r"], ळ: ["l"],
};

/** Clusters with a conventional spelling that is not the plain concatenation. */
const CLUSTERS: Record<string, string[]> = {
  "क्ष": ["ksh", "x", "chh", "ks"],
  "ज्ञ": ["gy", "gn", "jn", "dny"],
  "श्र": ["shr", "sr"],
  "श्व": ["shw", "shv", "sw", "sv"],
  "द्व": ["dw", "dv"],
  "स्व": ["sw", "sv"],
  "ज्व": ["jw", "jv"],
  "ह्म": ["hm"],
  "त्व": ["tw", "tv"],
  "ध्व": ["dhw", "dhv"],
  "क्व": ["kw", "kv", "qu"],
  "ष्ण": ["shn", "sn"],
  "ज़्य": ["zy"],
  "क्स": ["ks", "x"],
};

const VOWELS: Record<string, string[]> = {
  // inherent vowel: "a" or deleted; "e"/"u" only ever chosen from data (Inder, Dutt)
  a: ["a", "", "e", "u"],
  // matras
  "ा": ["a", "aa", "ah"], "ि": ["i", "e"], "ी": ["i", "ee", "y", "ie"], "ु": ["u", "oo", "o"], "ू": ["u", "oo"],
  "ृ": ["ri", "ru", "r"], "ॄ": ["ri"], "े": ["e", "ai", "ay", "ei", "ey"], "ै": ["ai", "ae", "ei", "e", "ay"], "ो": ["o", "oo"],
  "ौ": ["au", "ou", "o", "aw"], "ॉ": ["o", "au", "a"], "ॅ": ["e", "a"], "ॆ": ["e"], "ॊ": ["o"],
  // independent vowels
  "अ": ["a", "u"], "आ": ["a", "aa"], "इ": ["i", "e"], "ई": ["i", "ee", "e"], "उ": ["u", "oo"], "ऊ": ["u", "oo"],
  "ऋ": ["ri", "ru"], "ए": ["e", "ai", "ay"], "ऐ": ["ai", "ae", "ei"], "ओ": ["o"], "औ": ["au", "ou"],
  "ऑ": ["o", "au", "a"], "ऍ": ["e", "a"], "ऌ": ["lri"],
};

const NASAL_ALTS = ["n", "m", "ng", ""];

const LABIAL = new Set(["प", "फ", "ब", "भ", "म"]);
const VELAR = new Set(["क", "ख", "ग", "घ"]);
/** Consonants that can follow another one at the start of a syllable (pr, kl, vy, sw). */
const ONSET_SECOND = new Set(["र", "ल", "य", "व"]);
/** A word-final cluster ending in one of these keeps its vowel: Chandra, Shukla, Satya, Krishna, Ratna, Padma. */
const FINAL_CLUSTER_KEEP = new Set(["र", "ल", "य", "व", "ण", "न", "म"]);
const FRONT_VOWELS = new Set(["ि", "ी", "े", "ै"]);

const isReph = (u: Unit): boolean => u.cons.length >= 2 && u.cons[0].base === "र" && !u.cons[0].nukta;
/** Can the schwa before this unit be dropped, i.e. does the unit start a syllable on its own? */
function isOnset(u: Unit): boolean {
  if (u.cons.length === 1) return true;
  if (isReph(u)) return false;
  return ONSET_SECOND.has(u.cons[1].base) || u.cons[0].base === "स";
}

function consAlts(c: Consonant): string[] {
  const t = (c.nukta ? CONS_NUKTA[c.base] : undefined) ?? CONS[c.base];
  return t ?? ["?"];
}

/** Alternatives for a whole cluster: special table, else product of the first two alts of each member (capped). */
export function clusterAlts(cons: Consonant[]): string[] {
  const key = clusterKey(cons);
  const special = CLUSTERS[key];
  if (special) return special;
  if (cons.length === 1) return consAlts(cons[0]);
  let combos: string[] = [""];
  for (const c of cons) {
    const alts = consAlts(c).slice(0, 2);
    const next: string[] = [];
    for (const prefix of combos) for (const a of alts) next.push(prefix + a);
    combos = next.slice(0, 8);
  }
  // Geminates written with a double letter ("dd" for ड्ड) come out of the product naturally.
  // Also allow the doubled consonant to collapse ("Munni"/"Muni").
  if (cons.length === 2 && cons[0].base === cons[1].base && !cons[0].nukta) {
    const single = consAlts(cons[0])[0];
    if (!combos.includes(single)) combos.push(single);
  }
  // A reph cluster is often spelled with a vowel after the r: Karam, Dharam, Param (र्म -> "ram").
  if (cons.length === 2 && cons[0].base === "र" && !cons[0].nukta) {
    for (const a of consAlts(cons[1]).slice(0, 2)) combos.push("ra" + a);
  }
  // ...and a C+र cluster with one before it: Agarwal (ग्र -> "gar"), Chandar.
  if (cons.length === 2 && cons[1].base === "र" && !cons[1].nukta) {
    for (const a of consAlts(cons[0]).slice(0, 2)) combos.push(a + "ar");
  }
  return combos;
}

/** Schwa decision per unit (true = the inherent "a" is pronounced), right to left. */
export function schwaKeep(units: Unit[]): boolean[] {
  const content = units.map((u, i) => (u.kind === "X" ? -1 : i)).filter((i) => i >= 0);
  const first = content[0];
  const last = content[content.length - 1];
  const keep = new Array<boolean>(units.length).fill(true);
  const hasVowel = (u: Unit | undefined, idx: number): boolean => {
    if (!u) return false;
    if (u.kind === "V") return true;
    if (u.kind !== "C") return false;
    if (u.vowel === "") return false;
    if (u.vowel !== null) return true;
    return keep[idx]; // inherent: as decided (units to the right are decided already; to the left assume kept)
  };
  for (let i = units.length - 1; i >= 0; i--) {
    const u = units[i];
    if (u.kind !== "C" || u.vowel !== null) continue;
    if (i === last) {
      // Ram, Suresh, Chand, Anand, Harsh (deleted) vs Chandra, Mishra, Krishna, Satya, Ratna (kept)
      keep[i] = u.cons.length >= 2 && FINAL_CLUSTER_KEEP.has(u.cons[u.cons.length - 1].base);
      continue;
    }
    if (i === first) {
      keep[i] = true;
      continue;
    }
    const prev = units[i - 1];
    const next = units[i + 1];
    // A cluster ending in a semivowel, or a reph cluster, keeps its vowel (Satya, Vishwa, Chandra-kala,
    // Nir-ma-la); one ending in a stop behaves like a single consonant (Sa-mast-pur, Mast-ram).
    if (u.cons.length >= 2 && (isReph(u) || ONSET_SECOND.has(u.cons[u.cons.length - 1].base))) continue;
    if (u.nasal || u.visarga) continue; // a nasalised syllable is closed: Ram-chan-dra, Shan-kar
    if (!prev || prev.kind === "X") continue;
    if (!hasVowel(prev, i - 1)) continue;
    if (prev.nasal) continue; // An-ja-li, Ran-ja-na, Van-da-na
    if (!next || next.kind !== "C") continue;
    if (!hasVowel(next, i + 1)) continue; // next consonant lost its vowel: this one must keep it (Kamal, Lakhan)
    if (!isOnset(next)) continue; // Bi-sham-bar, Mo-ham-mad, Harsh-var-dhan: the next cluster closes this syllable
    keep[i] = false; // VC(a)CV -> delete: Kamla, Ramkumar, Amarnath, Omprakash
  }
  return keep;
}

function nasalDefault(next: Unit | undefined): number {
  if (next && next.kind === "C" && next.cons.length && LABIAL.has(next.cons[0].base)) return 1; // m
  if (next && next.kind === "C" && next.cons.length && VELAR.has(next.cons[0].base)) return 0; // n (Ganga, Shankar)
  return 0;
}

function vowelDefault(u: Unit, units: Unit[]): number {
  const v = u.vowel;
  const content = units.filter((x) => x.kind !== "X");
  const isFirst = content[0] === u;
  const isLast = content[content.length - 1] === u;
  if (u.kind === "C" && v === "ी") return isFirst && content.length > 1 ? 1 : 0; // Deepak/Neeraj vs Sunil/Devi
  if (u.kind === "C" && v === "ू") return isLast ? 0 : 1; // Babu/Guddu vs Pooja/Anoop/Noor
  return 0;
}

/** व is "v" at the edges and before front vowels (Vijay, Yadav, Savita, Devi), "w" in between (Tiwari, Pawan, Jaswant). */
function consDefault(u: Unit, units: Unit[], alts: string[]): number {
  if (u.cons.length !== 1 || u.cons[0].base !== "व") return 0;
  const content = units.filter((x) => x.kind !== "X");
  if (content[0] === u || content[content.length - 1] === u) return 0;
  if (u.vowel && FRONT_VOWELS.has(u.vowel)) return 0;
  const w = alts.indexOf("w");
  return w >= 0 ? w : 0;
}

/** Breaks a word's units into alignable slots with alternatives and rule defaults. */
export function slotsOf(units: Unit[]): Slot[] {
  const keep = schwaKeep(units);
  const slots: Slot[] = [];
  units.forEach((u, i) => {
    if (u.kind === "X") {
      slots.push({ key: `X:${u.text}`, kind: "X", alts: [u.text], dflt: 0, unitIndex: i });
      return;
    }
    if (u.kind === "C") {
      const alts = clusterAlts(u.cons);
      slots.push({ key: `C:${clusterKey(u.cons)}`, kind: "C", alts, dflt: consDefault(u, units, alts), unitIndex: i });
      if (u.vowel === null) {
        slots.push({ key: "V:a", kind: "V", alts: VOWELS.a, dflt: keep[i] ? 0 : 1, unitIndex: i });
      } else if (u.vowel !== "") {
        slots.push({ key: `V:${u.vowel}`, kind: "V", alts: VOWELS[u.vowel] ?? ["?"], dflt: vowelDefault(u, units), unitIndex: i });
      }
    } else {
      const v = u.vowel ?? "";
      slots.push({ key: `V:${v}`, kind: "V", alts: VOWELS[v] ?? ["?"], dflt: vowelDefault(u, units), unitIndex: i });
    }
    if (u.nasal) slots.push({ key: `N:${u.nasal}`, kind: "N", alts: NASAL_ALTS, dflt: nasalDefault(units[i + 1]), unitIndex: i });
    if (u.visarga) slots.push({ key: "H:ः", kind: "H", alts: ["h", ""], dflt: 0, unitIndex: i });
  });
  return slots;
}
