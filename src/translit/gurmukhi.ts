/**
 * Gurmukhi (Punjabi) -> Devanagari, letter for letter, so that Punjabi names go through the same
 * Hindi -> English transliteration (ਜਸਵਿੰਦਰ ਸਿੰਘ -> जसविंदर सिंघ -> Jasvinder Singh).
 *
 * The two Unicode blocks share their layout (U+0A00 + n is the Gurmukhi twin of U+0900 + n) for
 * consonants, vowels, signs, virama, nukta and digits. What Gurmukhi has of its own:
 *   tippi ੰ / bindi ਂ    -> anusvara ं
 *   addak ੱ              -> the next consonant doubled (ਬੱਗਾ -> बग्गा); before an aspirate, its
 *                           unaspirated partner (ਸੁੱਖ -> सुक्ख), as Hindi spells it
 *   ੳ / ੲ (vowel bearers) -> the independent vowel they carry (ੳ + ੁ -> उ, ੲ + ੀ -> ई)
 *   yakash ੵ             -> ्य;  udaat ੑ is dropped
 */

const GURMUKHI = /[਀-੿]/;

export function isGurmukhi(s: string): boolean {
  return GURMUKHI.test(s);
}

// Aspirate -> unaspirated partner (Devanagari code points), for addak before an aspirate.
const UNASPIRATED: Record<string, string> = {
  "ख": "क", "घ": "ग", "छ": "च", "झ": "ज", "ठ": "ट", "ढ": "ड", "थ": "त", "ध": "द", "फ": "प", "भ": "ब",
};

// Vowel bearer + sign -> independent vowel.
const BEARER: Record<string, string> = {
  "ੲਿ": "इ", "ੲੀ": "ई", "ੲੇ": "ए", "ੲੈ": "ऐ", "ੲ": "इ",
  "ੳੁ": "उ", "ੳੂ": "ऊ", "ੳੋ": "ओ", "ੳ": "उ",
};

function letter(c: string): string {
  const cp = c.codePointAt(0)!;
  if (cp === 0x0a70 || cp === 0x0a02) return "ं"; // tippi, bindi
  if (cp === 0x0a51) return ""; // udaat
  if (cp === 0x0a75) return "्य"; // yakash
  if (cp >= 0x0a00 && cp <= 0x0a6f) return String.fromCodePoint(cp - 0x100);
  return c;
}

export function gurmukhiToDevanagari(text: string): string {
  // ਸ਼ is its own letter (श), not स + nukta, so it must not reach the offset as ਸ + ਼.
  const s = text.normalize("NFC").replace(/ਸ਼/g, "ਸ਼").replace(/[ੲੳ][ਿੀੁੂੇੈੋ]?/g, (m) => BEARER[m] ?? BEARER[m[0]]);
  let out = "";
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "ੱ") {
      // addak: double the consonant that follows
      const next = chars[i + 1] ? letter(chars[i + 1]) : "";
      if (/^[क-ह]/.test(next)) out += (UNASPIRATED[next[0]] ?? next[0]) + "्";
      continue;
    }
    out += letter(chars[i]);
  }
  return out.normalize("NFC");
}
