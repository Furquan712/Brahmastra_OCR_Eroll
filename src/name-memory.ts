/**
 * Cross-PDF Hindi name memory: Devanagari name tokens read confidently in several different
 * PDFs become trusted for name consensus (src/consensus.ts), so every processed PDF helps
 * repair one-character OCR defects in the next. Learns only from reads, never from repairs:
 * a field that consensus changed is skipped, and a token must be confident in at least
 * `minPdfs` distinct PDFs (by sha256) before it is trusted. Re-running a PDF adds nothing.
 *
 * Stored as JSON at data/learned/hi-names.json; delete the file to forget everything.
 */
import fs from "node:fs";
import path from "node:path";
import type { VoterCard } from "./types.js";

const FILE_VERSION = 1;
/** Hashes kept per token; enough to prove "seen in N PDFs" without growing without bound. */
const MAX_HASHES = 8;

interface MemoryFile {
  version: number;
  minPdfs: number;
  /** token -> sha256 prefixes of the PDFs it was read confidently in */
  tokens: Record<string, string[]>;
}

export interface NameMemoryOptions {
  /** Field confidence (0..1) at or above which a read is learned. */
  learnConf?: number;
  /** Distinct PDFs a token must be confidently read in before it is trusted. */
  minPdfs?: number;
}

const nfc = (s: string): string => s.normalize("NFC");
const isName = (t: string): boolean => /^[ऀ-ॿ]+$/.test(t) && [...t].length >= 2;

export class NameMemory {
  private tokens = new Map<string, Set<string>>();
  private readonly learnConf: number;
  readonly minPdfs: number;
  private learnedAtLoad = 0;

  constructor(readonly file: string, opts: NameMemoryOptions = {}) {
    this.learnConf = opts.learnConf ?? 0.9;
    this.minPdfs = Math.max(1, opts.minPdfs ?? 2);
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8")) as MemoryFile;
      if (raw.version === FILE_VERSION) for (const [t, hs] of Object.entries(raw.tokens)) this.tokens.set(t, new Set(hs));
    }
    this.learnedAtLoad = this.learned().size;
  }

  /** Tokens trusted for consensus (confidently read in >= minPdfs PDFs). */
  learned(): Set<string> {
    const out = new Set<string>();
    for (const [t, hs] of this.tokens) if (hs.size >= this.minPdfs) out.add(t);
    return out;
  }

  /** Records the confident, unrepaired name tokens of one finished PDF. Returns tokens newly trusted. */
  learnFrom(pdfHash: string, cards: VoterCard[]): number {
    const before = this.learned().size;
    const h = pdfHash.slice(0, 16);
    for (const c of cards) {
      for (const f of ["nameHi", "relationNameHi"] as const) {
        const conf = c.fieldConf ? (f === "nameHi" ? c.fieldConf.name : c.fieldConf.relationName) : c.confidence;
        if (conf < this.learnConf) continue;
        if (c.extraFlags?.includes(f === "nameHi" ? "name_hi_corrected" : "relation_name_hi_corrected")) continue;
        for (const t of nfc(c[f]).split(/\s+/)) {
          if (!isName(t)) continue;
          const hs = this.tokens.get(t) ?? this.tokens.set(t, new Set()).get(t)!;
          if (hs.size < MAX_HASHES) hs.add(h);
        }
      }
    }
    return this.learned().size - before;
  }

  stats(): { candidates: number; learned: number; newThisRun: number } {
    const learned = this.learned().size;
    return { candidates: this.tokens.size, learned, newThisRun: learned - this.learnedAtLoad };
  }

  /** Atomic write (tmp + rename) so a crash never leaves a truncated file. */
  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const data: MemoryFile = {
      version: FILE_VERSION,
      minPdfs: this.minPdfs,
      tokens: Object.fromEntries([...this.tokens].sort(([a], [b]) => a.localeCompare(b)).map(([t, hs]) => [t, [...hs]])),
    };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data) + "\n");
    fs.renameSync(tmp, this.file);
  }
}
