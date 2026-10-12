import fs from "node:fs";
import path from "node:path";

export interface Template {
  name: string;
  description: string;
  extends?: string;
  match: { states: string[] };
  language: string;
  grid: { cols: number; rows: number };
  strips: { rowsPerStrip: number; padPx: number };
  fallbackBody: { top: number; bottom: number; left: number; right: number };
  detection: { minLineFraction: number };
  classify: { longEdgePx: number };
  labels: Record<string, string[]>;
  relationMap: Record<string, string>;
  genderMap: Record<string, string>;
  epicPatterns: string[];
  sectionHints: Record<string, string[]>;
  promptNotes: string;
  /** Settings for the local (tesseract) engine. Boxes are fractions of the card rectangle. */
  local: {
    langs: string;
    headerFraction: number;
    /** Tesseract page-segmentation mode for the cover page (default 4). */
    coverPsm?: number;
    epicBox: { left: number; top: number; width: number; height: number };
    serialBox: { left: number; top: number; width: number; height: number };
    bodyBox: { left: number; top: number; width: number; height: number };
  };
}

type RawTemplate = Partial<Template> & { name: string };

function deepMerge<T>(base: T, over: Partial<T>): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Array.isArray(v) && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v as Record<string, unknown>);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export function loadTemplates(dir: string): Map<string, Template> {
  if (!fs.existsSync(dir)) throw new Error(`Templates directory not found: ${dir}`);
  const raws = new Map<string, RawTemplate>();
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as RawTemplate;
    if (!raw.name) throw new Error(`Template ${f} has no "name"`);
    raws.set(raw.name, raw);
  }
  const resolved = new Map<string, Template>();
  const resolve = (name: string, chain: string[] = []): Template => {
    const cached = resolved.get(name);
    if (cached) return cached;
    const raw = raws.get(name);
    if (!raw) throw new Error(`Template "${name}" not found (referenced via ${chain.join(" -> ") || "cli"})`);
    if (chain.includes(name)) throw new Error(`Template inheritance cycle: ${[...chain, name].join(" -> ")}`);
    let tpl: Template;
    if (raw.extends) {
      const base = resolve(raw.extends, [...chain, name]);
      tpl = deepMerge(base, raw as Partial<Template>);
    } else {
      tpl = raw as Template;
    }
    validate(tpl);
    resolved.set(name, tpl);
    return tpl;
  };
  for (const name of raws.keys()) resolve(name);
  return resolved;
}

function validate(t: Template): void {
  const need = ["grid", "strips", "fallbackBody", "detection", "classify", "relationMap", "genderMap", "epicPatterns", "sectionHints", "local"];
  for (const k of need) {
    if ((t as unknown as Record<string, unknown>)[k] === undefined) {
      throw new Error(`Template "${t.name}" is missing "${k}"`);
    }
  }
  for (const p of t.epicPatterns) new RegExp(p); // throws on bad regex
}

/** Pick the template for a state: explicit override > state match > "default". */
export function selectTemplate(templates: Map<string, Template>, state: string, override?: string): Template {
  if (override) {
    const t = templates.get(override);
    if (!t) throw new Error(`Template "${override}" not found. Available: ${[...templates.keys()].join(", ")}`);
    return t;
  }
  const norm = state.trim().toLowerCase();
  for (const t of templates.values()) {
    if (t.match?.states?.some((s) => s.trim().toLowerCase() === norm)) return t;
  }
  const d = templates.get("default");
  if (!d) throw new Error(`No template matched state "${state}" and no "default" template exists`);
  return d;
}
