const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ImageRun, BorderStyle, ShadingType, LevelFormat, PageBreak, TableOfContents, Footer, PageNumber,
} = require("docx");

const FIG = __dirname + "/figures/";
const sizes = JSON.parse(fs.readFileSync(FIG + "sizes.json"));
const FONT = "Times New Roman";
const PAGE_W = 11906 - 2 * 1440; // A4 minus 1" margins, DXA

// ---------- helpers ----------
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 22, ...o });
const P = (t, o = {}) => new Paragraph({ spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, children: Array.isArray(t) ? t : [run(t)], ...o });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [run(t, { bold: true, size: 28 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [run(t, { bold: true, size: 24 })] });
const H3 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 }, children: [run(t, { bold: true, italics: true, size: 22 })] });
const bullet = (t) => new Paragraph({ numbering: { reference: "bul", level: 0 }, spacing: { after: 60 }, children: Array.isArray(t) ? t : [run(t)] });
const pending = (t) => run(`[PENDING — ${t}]`, { bold: true, highlight: "yellow" });
const caption = (t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 240 }, children: [run(t, { size: 20, italics: true })] });

function figure(file, cap, widthIn = 5.8) {
  const [w, h] = sizes[file];
  const wpx = Math.round(widthIn * 96), hpx = Math.round(wpx * h / w);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, children: [new ImageRun({ type: "png", data: fs.readFileSync(FIG + file), transformation: { width: wpx, height: hpx } })] }),
    caption(cap),
  ];
}

function table(header, rows, widths, cap) {
  const total = widths.reduce((a, b) => a + b, 0);
  const cw = widths.map((w) => Math.round(PAGE_W * w / total));
  const cell = (t, i, head) => new TableCell({
    width: { size: cw[i], type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: "E8E8E8", color: "auto" } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [new Paragraph({ spacing: { after: 0 }, children: [run(String(t), { size: 19, bold: head })] })],
  });
  const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200, after: 80 }, keepNext: true, children: [run(cap, { size: 20, bold: true })] }),
    new Table({
      width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: cw,
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, i, true)) }),
        ...rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) }))],
    }),
    new Paragraph({ spacing: { after: 200 }, children: [] }),
  ];
}

const body = [];
const add = (...xs) => xs.flat().forEach((x) => body.push(x));

// ---------- TITLE ----------
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 200 }, children: [run("Making the Invisible Roll Visible: Consensus OCR for Indian Electoral Rolls and an Audit Framework for the Special Intensive Revision", { bold: true, size: 32 })] }));
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run("[Author full name]", { size: 24 })] }));
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run("Algo Analytica · [Department / Institution if any]", { size: 22 })] }));
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [run("[corresponding e-mail] · ORCID: [0000-0000-0000-0000]", { size: 20, color: "555555" })] }));

add(H2("Abstract"));
add(P("The Election Commission of India (ECI) publishes every assembly constituency's electoral roll as a set of PDF files in which each page is a flattened raster image. The roll is therefore public in law but unreadable by machine, which makes an independent, large-scale audit of who is added to or removed from the roll practically impossible for citizens, journalists and researchers. This paper presents an open, CPU-only pipeline that converts these PDFs into structured records without any paid model API, and uses it to frame an audit of roll changes during the 2025–26 Special Intensive Revision (SIR). The pipeline combines multi-pass Tesseract recognition with per-field majority voting, page- and document-level name consensus, a cross-document Devanagari name memory, and a self-contained Hindi-to-Roman transliteration engine. Uncertain cards are flagged for human review rather than silently guessed. On a hand-checked page of 30 voter cards from Dadri (Uttar Pradesh), the pipeline reads EPIC numbers, age, gender and relation type with 100% accuracy and Devanagari names with 97%, with 27 of 30 cards fully correct, compared with 18 of 30 for single-pass Tesseract on the same page; two of the three residual errors are flagged. The transliteration engine reaches 100% exact match on 113 held-out names (86.7% for rules alone). A 390-page, 13-booth run on a Karnataka draft roll (10,257 records) completes in 74 minutes with zero network calls, and exposes a template-sensitivity failure mode that we analyse. We then define booth-level audit indicators (addition, deletion and modification rates by age, gender and household) and demonstrate household and age-structure reconstruction on real roll data. We discuss what image-only publication does and does not protect, and the ethical limits of research on voter-roll data."));
add(P([run("Keywords: ", { bold: true }), run("electoral rolls; optical character recognition; Devanagari; transliteration; election integrity; Special Intensive Revision; India; computational social science; document AI")]));

add(new Paragraph({ children: [new PageBreak()] }));
add(new Paragraph({ children: [run("Contents", { bold: true, size: 26 })], spacing: { after: 160 } }));
add(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }));
add(new Paragraph({ children: [new PageBreak()] }));

// ---------- 1 INTRODUCTION ----------
add(H1("1. Introduction"));
add(H2("1.1 Background and motivation"));
add(P("The electoral roll is the single document that decides who may vote. In India it is prepared and revised under the Representation of the People Act, 1950, and published by the Election Commission of India (ECI) for every assembly constituency (AC), split into one “part” per polling station. In 2025 the ECI began a Special Intensive Revision (SIR), first in Bihar and then in further states, in which the entire roll is re-verified through enumeration forms and large numbers of electors are added, deleted or modified [1, 2]. The scale and speed of the exercise have made the question of who was removed, and whether removals cluster by locality, age or gender, a matter of public and legal debate."));
add(P("Answering that question requires reading the roll. The ECI does publish it, on a public CDN, as one PDF per part. Each page of those PDFs is a rasterised image: there is no text layer, no table structure and no download in CSV or any other structured form. The roll is public in the legal sense and opaque in the practical sense. For a single constituency of 400–800 parts this means tens of thousands of pages of scanned Hindi or regional-script text."));

add(H2("1.2 Problem statement"));
add(P("Three properties of these documents make them difficult for off-the-shelf tools. First, the script: most rolls are printed in Devanagari (Hindi) or another Indic script, for which commodity OCR is markedly weaker than for Latin text, and in which a single dropped halant or a confusable consonant pair (ब/व, थ/ध) changes a name. Second, the scale: a full state is hundreds of thousands of pages, which rules out paying a vision-language model per page for most civil-society or academic budgets. Third, the stakes: an audit built on noisy extraction may itself mislead, so the pipeline must know, and say, when it is unsure."));

add(H2("1.3 Research questions"));
add(bullet([run("RQ1. ", { bold: true }), run("Can a low-cost, CPU-only pipeline recover the content of scanned Indian electoral rolls accurately enough to support an audit?")]));
add(bullet([run("RQ2. ", { bold: true }), run("How much do multi-pass voting, page- and document-level consensus, and cross-document name memory improve accuracy over single-pass OCR, and does the pipeline’s own uncertainty flagging capture the errors that remain?")]));
add(bullet([run("RQ3. ", { bold: true }), run("Given the extracted rolls, what booth-level indicators describe additions, deletions and modifications during the SIR, and what patterns do they reveal?")]));

add(H2("1.4 Contributions"));
add(bullet([run("C1. ", { bold: true }), run("An open, reproducible pipeline (downloader plus OCR, consensus and transliteration engine) that runs on a 2-vCPU server with no API key and no network access during recognition (Sections 4–5).")]));
add(bullet([run("C2. ", { bold: true }), run("An evaluation against hand-checked ground truth, with a single-pass baseline, ablations and a flag-calibration analysis (Section 6).")]));
add(bullet([run("C3. ", { bold: true }), run("A booth-level audit framework for roll revisions, with indicator definitions and an error-propagation method, demonstrated on real roll data (Sections 7–8).")]));
add(bullet([run("C4. ", { bold: true }), run("An ethical and legal framing for research on voter-roll data under the Digital Personal Data Protection Act, 2023 (Section 10).")]));

add(H2("1.5 Paper organisation"));
add(P("Section 2 describes the roll and its legal setting; Section 3 reviews related work; Section 4 the data; Section 5 the pipeline; Section 6 its evaluation; Section 7 the audit framework and Section 8 its application; Sections 9–12 discuss implications, ethics, limitations and future work."));

// ---------- 2 BACKGROUND ----------
add(H1("2. Background"));
add(H2("2.1 India’s electoral roll system"));
add(P("The roll is organised as State → Assembly Constituency → Part → Section → elector. A part corresponds to one polling station (booth) and typically holds 600–1,200 electors; a section is a locality (a street, hamlet or mohalla) within the part. Each elector carries an EPIC (Electors Photo Identity Card) number, a name, a relation (father, mother or husband) and the relative’s name, a house number, age and gender. The ECI publishes a draft roll, accepts claims and objections on prescribed forms (Form 6 for inclusion, Form 7 for objection or deletion, Form 8 for correction), and then publishes a final roll. Between publications, supplements list additions, deletions and modifications separately."));
add(H2("2.2 The Special Intensive Revision"));
add(P("Unlike a routine summary revision, a SIR re-enumerates the whole electorate: every existing elector must be matched to an enumeration form, and electors who are not matched are not carried into the draft. The 2025 Bihar SIR, ordered in June 2025, reported several million names dropped between the previous roll and the draft [2]. Subsequent SIR phases extended to further states, including those studied here. Because the draft, the final roll and the supplements are all published, it is in principle possible to trace what happened to every elector—if the documents can be read."));
add(H2("2.3 Anatomy of a roll PDF"));
add(P("Figure 1 shows a representative page, pixelated for publication. A part PDF begins with a cover page (constituency and part identifiers, polling-station name and address, the administrative units from village to district, and elector counts) followed by a grid of elector cards, three per row and ten per page, each boxed with a printed border. Supplement lists use the same card layout but print a marker in the serial box (for example “S2 144” for an elector shifted out in supplement 2, or “#2 93” for a modified entry). Page headers carry the section number and name; footers carry the printed page number. Every one of these elements is image only."));
add(figure("fig1_roll_page_redacted.png", "Figure 1. A voter-card page from a Hindi SIR final roll (Dadri, Uttar Pradesh, part 794, page 3), pixelated so that no personal data is legible. Three cards per row, ten rows per page; each card prints an EPIC number (top right), name, relation and relative’s name, house number, age and gender, and a serial number (top left).", 3.6));
add(H2("2.4 Legal and policy context"));
add(P("Section 16 of the Representation of the People Act, 1950, and the Registration of Electors Rules, 1960, require the roll to be published and make copies available. The Digital Personal Data Protection Act, 2023 (DPDP) governs the processing of the personal data the roll contains; publicly available personal data is exempt from several of its obligations only where the data principal themselves made it public, which is not the case here. Any research use must therefore be purpose-limited and minimised (Section 10). The ECI has stated that image-only publication is intended to prevent bulk harvesting of elector data; we return to whether it achieves this in Section 9.4."));

// ---------- 3 RELATED WORK ----------
add(H1("3. Related work"));
add(H2("3.1 OCR for Indic scripts"));
add(P("Tesseract 4/5 provides LSTM models for Hindi and most Indic scripts [3]; its accuracy on clean print is good but degrades sharply on low-resolution scans and conjunct-heavy text. Transformer-based recognisers such as TrOCR [4] and OCR-free document models such as Donut [5] improve on it for Latin text but have limited Indic training data and need a GPU. Indic-specific benchmarks and models (IndicOCR, the Bhashini initiative) are improving but remain uneven across scripts."));
add(H2("3.2 Vision-language models for forms"));
add(P("Multimodal LLMs read structured forms well in zero-shot settings, and we use one as an optional second reader. Their drawbacks for this task are cost at the scale of hundreds of thousands of pages, latency, and a tendency to produce fluent but wrong values—for example returning the parliamentary constituency where the assembly constituency was asked for—without any signal of uncertainty."));
add(H2("3.3 Transliteration of Indian names"));
add(P("Hindi-to-Roman transliteration is many-to-many: the same Devanagari name is written Sunil or Suneel, Vinod or Binod, according to regional convention and the data-entry operator who typed it. Large parallel corpora (Dakshina [6], Aksharantar [7]) support neural transliterators, but the spellings on official identity documents follow their own conventions (no diacritics, “sh”, “chh”, schwa deletion as spoken), which motivates a rule-plus-lexicon approach in our setting."));
add(H2("3.4 Multi-pass OCR and post-OCR correction"));
add(P("Ensembling several OCR passes and voting on the output is a long-standing technique [8], as is lexicon-driven post-correction [9]. Our contribution is to apply these at the level of individual fields with field-specific passes (digit whitelists for EPIC and age, Hindi-only passes for names), and to add a consensus step that repairs a low-confidence name towards a trusted token only when the two differ by a single edit that Tesseract is known to make."));
add(H2("3.5 Computational studies of voter lists"));
add(P("The most developed literature on voter-file quality is American: validation of self-reported turnout against voter files [10], matching of registrations across states and the error rates of such matching [11], and audits of purge lists. Indian work has largely relied on aggregate ECI statistics or on manual sampling of printed rolls, because the rolls have not been machine-readable at scale. Civic-technology efforts have occasionally scraped individual rolls, but without a validated, open extraction method."));
add(H2("3.6 Research gap"));
add(P("We are not aware of a published, validated, open pipeline for Indic-script electoral rolls, nor of a booth-level audit of SIR roll changes built on one. This paper addresses both."));

// ---------- 4 DATA ----------
add(H1("4. Data"));
add(H2("4.1 Source and collection"));
add(P("All documents come from the ECI’s public CDN. Each roll type follows a fixed URL pattern, for example /eroll/<year>/<state>/sir-finalroll/<ac>/<year>-EROLLGEN-<state>-<ac>-SIR-FinalRoll-Revision1-<lang>-<part>-WI.pdf, with analogous patterns for draft rolls and for supplements. The downloader (e_rolls.py) discovers which roll types exist for a constituency by probing part 1, finds the last part number by binary search on the main roll (about 15 requests for an 800-part constituency), and then fetches each candidate file once: a 404 is the signal that a part does not exist (normal for supplements, which are published only for parts that changed). Files already on disk and valid are never re-requested; partial files are resumed; the client backs off on 406/429/5xx responses and never retries a definitive 4xx. Download rate was deliberately throttled, and all requests identify themselves."));
add(H2("4.2 Corpus"));
add(P("Table 1 summarises the corpus assembled at the time of writing. The Uttar Pradesh collection is the largest: 31 constituencies with a published SIR roll, 14,477 parts published and 12,513 retrieved (70.7 GB); Figure 2 shows per-constituency coverage. Hindi-language rolls (Uttar Pradesh) and English-language rolls (Karnataka, Andhra Pradesh, Maharashtra) are both represented. The Karnataka constituency (35-Jewargi) was processed end-to-end locally and is the basis of the large-scale run in Section 6.7; the Uttar Pradesh rolls were processed on a separate server whose per-constituency outputs are not yet consolidated here."));
add(table(["State", "Language", "ACs with roll", "Parts published", "Parts retrieved", "Size on disk", "Roll types"],
  [["Uttar Pradesh", "Hindi", "31", "14,477", "12,513", "70.7 GB", "SIR final roll"],
   ["Karnataka (35-Jewargi)", "English", "1", "285", "285", "≈2.7 GB", "SIR draft roll"],
   ["Andhra Pradesh (21, 81)", "English", "2", "606", "36 (in progress)", "0.4 GB", "SIR draft roll"],
   ["Maharashtra (199-Daund)", "English", "1", "315", "in progress", "—", "SIR draft roll"],
   ["Total", "", "35", "15,683", "≥ 12,834", "≈ 74 GB", ""]],
  [2.2, 1.1, 1.1, 1.3, 1.5, 1.2, 1.4], "Table 1. Corpus of electoral-roll PDFs collected from the ECI CDN (status as of 29 October 2026). One part = one polling station = one PDF of 15–40 pages."));
add(figure("fig11_up_corpus.png", "Figure 2. Uttar Pradesh collection coverage: parts published on the ECI CDN versus parts retrieved, for the 31 constituencies with a published SIR final roll. Gaps are files that returned persistent errors from the CDN at collection time and are re-tried on later runs.", 5.2));
add(H2("4.3 Ground-truth benchmark"));
add(P("Field-level evaluation uses a hand-checked page: page 3 of part 794 of the Dadri (AC-62, Uttar Pradesh) SIR final roll, 30 cards, read by eye from the 300-dpi rendering and recorded as JSON (test/fixtures/dadri-794-p3.json). Every field of every card was transcribed: EPIC, name, relation type, relative’s name, house number, age, gender, and serial. The transliteration benchmark is a separate held-out set of 113 Devanagari names as Tesseract reads them from Dadri rolls, paired with the Roman spelling a data-entry operator would write (data/translit/eval.tsv); it is never used for training. "), pending("the benchmark must be enlarged before submission to at least 300–500 cards across 3+ states and both print qualities, with a second annotator and an inter-annotator agreement figure; see Section 11.1"));
add(H2("4.4 Limitations of the data"));
add(P("The corpus is a convenience sample of constituencies for which rolls were published and collection completed; it is not a random sample of India. Supplements (additions, deletions, modifications) had not yet been published for the Karnataka draft roll at collection time, which limits the audit in Section 8 to what a single draft roll reveals."));

// ---------- 5 METHOD I ----------
add(H1("5. Methodology I: the extraction pipeline"));
add(figure("fig2_pipeline.png", "Figure 3. End-to-end pipeline. Every stage runs locally; the optional hybrid engine sends only flagged cards to a vision model.", 6.2));
add(H2("5.1 Overview"));
add(P("Figure 3 shows the stages. A folder of PDFs is processed two files at a time, one page at a time; the result for each page is cached by content hash so that interrupted runs resume. The pipeline is written in TypeScript (Node 20) and calls Tesseract 5 and Poppler as subprocesses; it has no other runtime dependency."));
add(H2("5.2 Pre-processing and page classification"));
add(P("Pages are rendered at 300 dpi with pdftoppm. Page 1 is treated as a cover unless it lacks cover vocabulary, in which case (for supplement PDFs, which have no cover) the header line “Supplement 2 / AC 26-DABOLIM / Part No. 17” and the file name supply the identifiers. For every other page the strip above the first card is read and classified as main roll (header “अनुभाग संख्या और नाम : 1-…” or “Section No and Name 1-…”), additions, deletions, modifications, summary, or other. An unreadable header on a page with a card grid is assumed to be a main-roll page and a warning is logged."));
add(H2("5.3 Cover-page parsing"));
add(P("The cover is OCR’d in full and the state, AC number and name, part number, year, draft/final status, dates and elector counts are extracted with regular expressions and cross-checked against the file name, which encodes state, AC, roll type, language and part. The administrative-unit box (village, ward, post office, police station, panchayat, block, tehsil, district, PIN) is located from its label words and re-read at 2× scale; the PIN is read with a digit-only whitelist. The cover parse is deterministic; in an early comparison the vision model returned the parliamentary seat as the assembly constituency on one sample, which the regex parse, anchored to the file name, cannot do."));
add(H2("5.4 Layout analysis"));
add(P("Card rectangles are found from the printed borders: horizontal and vertical ink profiles locate the ten row bands and three columns, giving up to 30 rectangles per page in reading order. Within each card the serial box (top left) and the section box are located from their own borders so that the detector is independent of print size. Bordered cells that contain nothing voter-like (a totals table at the end of a list) are dropped."));
add(H2("5.5 Field recognition"));
add(bullet([run("EPIC. ", { bold: true }), run("The EPIC box is read three times with the English model and an alphanumeric whitelist—at 1×, 2× and 3× scale with binarisation—and the reads are majority-voted character by character. An EPIC that fails the format check (three letters and seven digits, or a legacy slash form) is flagged epic_invalid; a vote that changed the plurality read is recorded as epic_autocorrected.")]));
add(bullet([run("Serial. ", { bold: true }), run("The serial box is read as digits and as letters-plus-digits so that the deletion/modification markers (“S2 144”, “#2 93”) are captured. On main-roll and addition pages the serial is cross-checked against grid order; a disagreement is resolved towards grid order and flagged serial_corrected.")]));
add(bullet([run("Names and labels. ", { bold: true }), run("The card body is read once with the bilingual eng+hin model (labels, digits) and once with the Hindi-only model at 2× (names). Fields are located by fuzzy matching of their printed labels. The two name reads are voted: a read containing Latin garbage is dropped, and the higher-confidence read wins otherwise.")]));
add(bullet([run("Age, gender, relation. ", { bold: true }), run("The age line is re-read at 3× with a digit whitelist when the first read is uncertain; gender and relation type are matched fuzzily against their small closed vocabularies (पुरुष/महिला/अन्य; पिता/माता/पति).")]));
add(H2("5.6 Consensus and error repair"));
add(P("After a page is read, and again after a PDF is complete, a consensus pass repairs names. A Devanagari token read with low confidence that differs from a trusted token by exactly one edit of a kind Tesseract is known to make—a dropped or stray halant, nukta or anusvara; a swap between look-alike vowel signs (े/ै, ो/ौ, ु/ू, ि/ी); or a swap between look-alike consonants (ब/व, थ/ध, घ/ध, भ/म, श/ष, न/ण, and others)—is replaced by it and flagged name_hi_corrected, with the original read kept in the log. A trusted token is one read with confidence elsewhere on the same page or PDF, or present in the name lexicon. Matras are never dropped or added and consonants are never inserted, so a rare but real spelling (चन्दा, खुरशैद) survives as long as it was read with confidence."));
add(P("The lexicon is built by a cross-document name memory. Tokens read with field confidence ≥ 0.90 (and not themselves a consensus repair) are recorded per PDF hash; a token joins the lexicon once it has been read confidently in two different PDFs. Re-running a PDF adds nothing and a PDF never confirms itself, so the memory improves new documents, not those it was learned from. At the time of writing the memory holds 141,717 tokens."));
add(H2("5.7 Transliteration"));
add(P("Roman names are produced locally in three layers. (1) Rules: Devanagari is syllabified and transliterated with schwa deletion as spoken (सुरेश → Suresh, कमला → Kamla, रामचंद्र → Ramchandra), nasal and conjunct rules, and the conventions of Indian identity documents (sh, chh, kh; no diacritics). (2) A learned re-ranker: for each syllable the rules enumerate the spellings it may take (ी → i/ee, व → v/w, inherent a kept or dropped); training aligns each of 1,905 seed pairs to those alternatives and counts which was used in which context (neighbouring syllables, word position). At run time alternatives are re-ranked by those counts, backing off to the rule when there is no evidence. (3) An exact-match lexicon of attested tokens and a hand-maintained override table (46 entries) applied first."));
add(H2("5.8 Uncertainty flagging"));
add(P("The pipeline never drops a row. Every card is written with a per-card confidence and zero or more flags from a fixed taxonomy (Appendix C): low_confidence (card confidence below 0.70), epic_low_conf, name_low_conf, relation_name_low_conf, age_gender_low_conf, *_unreadable, *_missing, epic_invalid, epic_autocorrected, serial_corrected, serial_gap, page_no_mismatch, age_under_18 and age_out_of_range. In the hybrid engine, cards whose Tesseract confidence is below 0.85 are sent to a vision model for a second read; in the local engine they are simply flagged."));
add(H2("5.9 Merge, deduplication and validation"));
add(P("All PDFs of a folder are merged into one CSV; where an EPIC appears twice the later row wins (supplements supersede the main roll), and every row records which list it came from (Action_status: existing, added, deleted, modified; Supplement_no). A summary (JSON and text) records per-PDF card and page counts, flag counts and warnings, and the run can push each finished PDF directly to a dashboard."));
add(H2("5.10 Implementation and resource footprint"));
add(P("The target deployment is a 2-vCPU, 4-GB server; the local engine needs no API key and makes no network call. The runs reported here were performed on a laptop-class machine. Throughput on the Karnataka run was 0.088 pages/s (5.3 pages/min) at 300 dpi with the multi-pass configuration, i.e. roughly 75 minutes per 400 pages; a 285-part constituency of about 30 pages per part is therefore about 27 CPU-hours."));

// ---------- 6 EVALUATION ----------
add(H1("6. Evaluation of the pipeline (RQ1, RQ2)"));
add(H2("6.1 Setup"));
add(P("We report field accuracy (a field is correct when it matches the ground truth exactly after whitespace normalisation), card accuracy (all fields correct), and flag calibration (of the cards with an error, how many carry a flag; of the flagged cards, how many are in fact wrong). The baseline is a single Tesseract pass (eng+hin, page segmentation mode 3) over the whole 300-dpi page; a baseline field counts as correct if the ground-truth string occurs verbatim in the page text, which is generous to the baseline because it ignores the problem of assigning text to cards. All measurements were re-run for this paper with the shipped ocr-eval command."));
add(H2("6.2 Field- and card-level accuracy"));
add(table(["Field", "Single-pass Tesseract", "Consensus pipeline", "Residual error (pipeline)"],
  [["EPIC number", "23/30 (77%)", "30/30 (100%)", "—"],
   ["Name (Devanagari)", "24/30 (80%)", "29/30 (97%)", "बिट्टो read as विट्रो (two defects in one token; flagged)"],
   ["Relation type", "—", "30/30 (100%)", "—"],
   ["Relative’s name", "27/30 (90%)", "29/30 (97%)", "खुरशैद normalised to खुरशेद by consensus (flagged, original kept)"],
   ["House number", "—", "29/30 (97%)", "“.2” read as “2” (not flagged)"],
   ["Age", "30/30 (100%)", "30/30 (100%)", "—"],
   ["Gender", "—", "30/30 (100%)", "—"],
   ["Card fully correct", "18/30 (60%)*", "27/30 (90%)", "3 cards; 2 of them flagged"]],
  [1.5, 1.4, 1.4, 2.6], "Table 2. Accuracy on the hand-checked Dadri page (30 cards). *Baseline card accuracy counts EPIC, name and relative’s name only, the three fields the baseline can be scored on, and is therefore an upper bound."));
add(figure("fig3_accuracy_vs_baseline.png", "Figure 4. Correct cards per field on the hand-checked page: single-pass Tesseract versus the consensus pipeline. *Card-level for the baseline covers EPIC, name and relative’s name only.", 4.8));
add(P("The pipeline removes every EPIC error and five of the six name errors made by the single pass. The three residual card errors are instructive: one is a name with two defects in one token, which the single-edit consensus rule deliberately does not repair; one is the roll’s own inconsistent spelling of a name (खुरशैद beside खुरशेद) being normalised towards the more frequent form; and one is a house number whose leading full stop was lost. The first two carry flags; the third does not, and is the only silent error on the page."));
add(H2("6.3 Flag calibration"));
add(figure("fig4_flag_calibration.png", "Figure 5. Flag calibration on the hand-checked page. Of 30 cards, 12 are flagged for review; 2 of those contain an error. One erroneous card (a house-number punctuation loss) is not flagged.", 4.6));
add(P("Twelve of 30 cards were flagged. Two of the three erroneous cards are among them (recall 0.67 at card level; both name errors are caught, the house-number error is not), and 10 of the 12 flagged cards are in fact correct (precision 0.17). The flags are therefore conservative: a reviewer who checks every flagged card will see mostly correct cards, but will catch nearly every field that matters for identity. For an audit this is the right trade-off, and it is tunable through the confidence threshold."));
add(H2("6.4 Ablation"));
add(P([run("The README of the project reports that on the same page the Hindi-only pass, the field votes and the consensus repair together account for the gain from 20/30 to 27/30 fully correct cards. "), pending("a per-component ablation (voting off; Hindi-only pass off; consensus off; name memory off) must be run with ocr-eval on the enlarged benchmark and reported here as Table 3")]));
add(H2("6.5 Transliteration"));
add(table(["Configuration", "Exact match (113 held-out names)", ""],
  [["Rules only", "98/113", "86.7%"], ["Rules + learned re-ranker (no lexicon)", "104/113", "92.0%"], ["Full engine (re-ranker + lexicon + overrides)", "113/113", "100.0%"]],
  [3, 2, 1.2], "Table 3. Hindi → Roman transliteration accuracy. The held-out set is not used for training; the lexicon is built from the seed corpus only."));
add(figure("fig5_translit_ablation.png", "Figure 6. Transliteration accuracy by configuration on the held-out set.", 4.2));
add(P("The remaining rule-only errors are spelling conventions rather than phonetic mistakes (फिरोज → Firoj for Firoz; शाहरूख → Shahrookh for Shahrukh); the re-ranker learns most of these from context and the lexicon closes the rest. We caution that 100% on 113 names from one district says little about other regions, whose Roman conventions differ (Section 11)."));
add(H2("6.6 Cost and throughput"));
add(table(["Engine", "Model calls per 390 pages", "Tokens", "Wall time (390 pages)", "Marginal cost"],
  [["local (this paper)", "0", "0", "74 min", "$0"], ["hybrid", "flagged cards only (≈ 20–65% of cards, see 6.7)", "proportional", "+ API latency", "a few cents per PDF"], ["llm (every page in strips)", "≈ 3 per page", "high", "API-bound", "highest"]],
  [1.5, 2, 1, 1.4, 1.3], "Table 4. Resource footprint of the three engines. Local figures are measured on the Karnataka run (summary JSON); hybrid and llm figures are design properties and were not benchmarked at scale for this paper."));
add(H2("6.7 Robustness at scale: a 13-booth run and a failure mode"));
add(P("To test behaviour beyond a single curated page, we ran the local engine over 14 parts of the Jewargi (AC-35, Karnataka) SIR draft roll, an English-language roll processed with the layout template built for Goa’s English rolls. The run read 390 pages and wrote 10,257 elector rows in 74 minutes with no model calls; 13 PDFs succeeded and one failed on a layout-detection error (a negative crop height), which is a bug rather than a data problem. Figure 7 shows cards per booth; Figure 8 the flag distribution."));
add(figure("fig10_cards_per_booth.png", "Figure 7. Elector cards read per part (booth) in the Jewargi run. Booth sizes of 620–1,030 electors are typical for the ECI’s target of ≈ 1,200 per polling station.", 5.2));
add(figure("fig6_jewargi_flags.png", "Figure 8. Flags raised on the 10,257 rows of the Jewargi run. Rows may carry several flags; 6,679 rows (65%) carry at least one.", 5.4));
add(P("The result is sobering and useful. Sixty-five per cent of rows carry at least one flag, against 40% on the Dadri page, and 1,090 rows (10.6%) carry age_under_18, which in a real roll is impossible and marks a mis-read age. The cause is template mismatch: Karnataka’s English print places the EPIC and age fields differently from Goa’s, so the field-specific passes read partly outside their boxes. The pipeline did what it is designed to do—it did not drop or silently accept these rows, it flagged them—but it also shows that a new state’s print needs its own template and its own hand-checked page before the output can be trusted. Figure 9 shows the per-card confidence on part 1 of the same roll: a bimodal distribution with a cluster of 101 cards near zero confidence (cards the layout stage mislocated) and the bulk above the 0.70 threshold."));
add(figure("fig7_confidence_hist.png", "Figure 9. Per-card OCR confidence, Jewargi part 1 (749 cards). The dashed line is the low_confidence threshold.", 4.8));
add(H2("6.8 Error analysis"));
add(P("Across both runs the error classes are: (i) look-alike Devanagari glyphs in names, mostly repaired by consensus when a trusted token exists; (ii) lost punctuation in house numbers; (iii) template mismatch, which is systematic and detectable from the flag rate; (iv) layout-stage failures on individual pages (one PDF in 14), which abort the PDF rather than emit wrong rows. None of the errors observed produced a plausible-but-wrong EPIC, the failure that would most compromise an audit."));

// ---------- 7 AUDIT FRAMEWORK ----------
add(H1("7. Methodology II: an audit framework for roll revisions (RQ3)"));
add(H2("7.1 Audit questions"));
add(P("Given a draft roll D, a final roll F and supplements S1…Sn for a constituency, each elector row carries an Action_status (existing, added, deleted, modified) and the supplement it came from. The audit asks, for each booth and for the constituency: how many electors were added, deleted and modified; whether deletions are concentrated in particular booths or sections; whether the age and gender composition of deleted electors differs from that of the roll; and whether deletions cluster within households."));
add(H2("7.2 Units of analysis"));
add(P("Constituency, part (booth), section (locality) and household. A household is defined, following the dashboard’s deep-analysis module, as the electors of one part who share a house number after print noise (“H.No 195”, “Hno-195”, “195”) is folded together; its head is the oldest member. Deleted electors are excluded from household and age figures, as the ECI’s own counts do."));
add(H2("7.3 Indicators"));
add(table(["Indicator", "Definition", "Level"],
  [["Deletion rate", "deleted / (existing + deleted)", "booth, section, constituency"],
   ["Addition rate", "added / final electors", "booth, section, constituency"],
   ["Modification rate", "modified / final electors", "booth"],
   ["Deletion age profile", "share of deletions in each age band vs share of roll in that band", "constituency"],
   ["Deletion sex ratio", "female deletions per 1,000 male deletions vs roll sex ratio", "booth, constituency"],
   ["Whole-household deletion", "households of size ≥ 2 in which every member was deleted", "booth"],
   ["Booth outlier score", "robust z-score of booth deletion rate (median/MAD) within the constituency", "booth"]],
  [1.6, 3.4, 1.6], "Table 5. Audit indicators."));
add(H2("7.4 Statistical methods"));
add(P("Rates are reported with Wilson 95% confidence intervals. Booth-level outliers are identified with a robust z-score (median and median absolute deviation) rather than mean and standard deviation, because the deletion-rate distribution is expected to be skewed. Differences in age and gender composition between deleted electors and the roll are tested with chi-squared tests on the banded counts. Where booth coordinates are available (the dashboard geocodes polling stations), spatial autocorrelation of booth deletion rates is measured with Moran’s I."));
add(H2("7.5 Propagating extraction error into audit estimates"));
add(P("Every indicator is computed twice: on all rows, and on rows without identity-affecting flags (epic_low_conf, epic_invalid, name_low_conf, age_gender_low_conf). The gap between the two is the sensitivity of the finding to extraction noise. In addition, the measured field error rates from Section 6 are used to bound each count: a deletion count d with an EPIC error rate e has a worst-case misattribution of d·e. A finding is reported only if it survives both the flag-exclusion and the error-bound check."));

// ---------- 8 RESULTS ----------
add(H1("8. Results: application of the audit framework"));
add(H2("8.1 Scope of what can be reported now"));
add(P([run("The Karnataka draft roll had no published supplements at collection time, and the Uttar Pradesh constituencies’ supplement outputs are not yet consolidated. The addition/deletion indicators of Table 5 therefore cannot be reported in this draft. What follows demonstrates the household and demographic reconstruction on which they depend, on real extracted data (Jewargi part 1, 749 rows). "), pending("Sections 8.2–8.6 are to be filled with addition/deletion results once (a) the Jewargi final roll and supplements are published and processed, and (b) the Uttar Pradesh final-roll-plus-supplement runs are consolidated. Each figure and table below that reads ‘PENDING’ is a placeholder, not a result.")]));
add(H2("8.2 Demographic structure of a booth from extracted data"));
add(figure("fig8_age_pyramid.png", "Figure 10. Age–gender structure of Jewargi part 1 as read by the pipeline (653 electors with a readable age ≥ 18 and gender; 87 rows with an age read below 18 are excluded as flagged OCR errors).", 4.8));
add(P("The pyramid in Figure 10 is read entirely from scanned images. Its shape—a bulge at 26–45 and a thin 18–25 band—is consistent with a rural Karnataka booth and with the known under-registration of first-time voters, which an audit of additions would be able to quantify. The sex ratio of readable rows is 938 women per 1,000 men (316/337)."));
add(H2("8.3 Household reconstruction"));
add(figure("fig9_household_size.png", "Figure 11. Electors per house number, Jewargi part 1. 211 distinct house numbers; 66 single-elector households and 10 of nine or more electors.", 4.4));
add(P("House-number folding yields 211 households. The long tail (four households of 13 or more electors sharing a house number, and 25 rows under the bare village name) is characteristic of rural rolls, where a house number can denote a compound or a cluster; this matters because the whole-household deletion indicator must treat such clusters with care, or a large compound would register as one household wrongly ‘wiped’."));
add(H2("8.4 Scale of roll change"));
add(P([pending("Table 6: additions, deletions and modifications by booth, with Wilson CIs, for each constituency with processed supplements")]));
add(H2("8.5 Demographic and household patterns of deletions"));
add(P([pending("Figure 12: age–gender pyramid of deleted electors against the roll; Table 7: deletion sex ratio by booth; whole-household deletion counts")]));
add(H2("8.6 Booth-level outliers and cross-state comparison"));
add(P([pending("Figure 13: robust z-scores of booth deletion rate; Moran’s I where booths are geocoded; comparison across the Uttar Pradesh constituencies")]));
add(H2("8.7 Robustness checks"));
add(P([pending("every reported indicator recomputed on flag-excluded rows and bounded by the Section 6 error rates, per Section 7.5")]));

// ---------- 9 DISCUSSION ----------
add(H1("9. Discussion"));
add(H2("9.1 What the evaluation shows"));
add(P("On rolls for which a template and a hand-checked page exist, the local engine reads identity fields (EPIC, age, gender, relation) without error on the benchmark page and names with one error in thirty, and it flags most of what it gets wrong. That is sufficient for booth-level aggregate audit, where a one-per-cent name error does not change a deletion rate, provided the error bound of Section 7.5 is carried through. It is not sufficient for individual-level claims about a named elector, and we do not make any."));
add(H2("9.2 Implications for election administration and transparency"));
add(P("The principal implication is that image-only publication does not prevent structured extraction; it only raises the cost of extraction to a level that favours well-resourced actors over citizens and researchers. A commodity CPU reads a constituency in a day. If the ECI’s concern is bulk harvesting of personal data, that concern is not addressed by rasterisation; if its concern is public scrutiny of revisions, rasterisation serves it only by obscurity."));
add(H2("9.3 Implications for low-resource document AI"));
add(P("Three design choices generalise beyond electoral rolls. Field-specific recognition passes (whitelists, scale, script model) beat a single generic pass by a wide margin on structured forms. Single-edit consensus against trusted tokens repairs the dominant Devanagari error classes without a language model. And a flag taxonomy with a tunable threshold turns an OCR system into an instrument whose uncertainty is reported, which is what makes it usable for evidence."));
add(H2("9.4 Is image-only publication an effective privacy safeguard?"));
add(P("No, and arguably it is the worst of both worlds: it does not stop extraction by motivated parties, while it prevents the privacy-preserving alternative—official publication of booth-level aggregate statistics on additions and deletions (counts by age band and gender, with no names)—from being the obvious thing for the Commission to do. We recommend that aggregate revision statistics be published alongside the rolls."));
add(H2("9.5 Recommendations"));
add(bullet("For the ECI: publish, with each draft and final roll, a booth-level CSV of elector counts and of additions, deletions and modifications by age band and gender; this is data the Commission already holds."));
add(bullet("For researchers and civil society: use validated, open extraction with reported error rates; publish aggregates only; preregister audit indicators before the supplements are published."));
add(bullet("For tool builders: ship uncertainty flags and a benchmark page for each new print template; treat a high flag rate as a signal to stop and build a template, not as noise to filter."));
add(H2("9.6 Generalisability"));
add(P("The layout engine is template-driven and has been exercised on Hindi (Uttar Pradesh) and English (Goa, Karnataka) prints; adding a state means adding a template and a benchmark page, which is a day’s work. The transliteration engine is Hindi-specific; Marathi, Telugu and Kannada rolls need their own rules and seed corpora."));

// ---------- 10 ETHICS ----------
add(H1("10. Ethical considerations"));
add(H2("10.1 Personal data and the DPDP Act"));
add(P("Electoral rolls contain personal data of every adult. Processing it for research is lawful under the DPDP Act only for a specified purpose and with minimisation; the public-availability exemption does not apply because the electors did not make the data public themselves. All processing in this study is for the purpose of aggregate audit of the revision process."));
add(H2("10.2 Data minimisation and release policy"));
add(P("No row-level data, no names and no EPIC numbers are published with this paper. Figures and tables are aggregates at booth level or above, and any cell with fewer than five electors is suppressed. The code is released; the extracted CSVs are not. The benchmark page is distributed pixelated; the ground-truth JSON that accompanies the code contains the names of 30 real electors as printed in a public document, and we discuss with the venue whether it should be replaced by a synthetic page before publication."));
add(H2("10.3 No inference of sensitive attributes"));
add(P("The transliteration layer would make it technically possible to infer religion or caste from names. We do not do so, the released code contains no such function, and we consider any audit that does so to have left the domain of election integrity for that of profiling."));
add(H2("10.4 Dual use"));
add(P("The same pipeline that enables an audit enables campaign targeting. The authors are affiliated with a company whose product uses extracted rolls for campaign analytics (see 10.6). The mitigations are that the paper publishes method and aggregates, not data; that the audit framework is preregistered; and that the recommendations of Section 9.5 would, if adopted, make the extraction itself unnecessary."));
add(H2("10.5 Ethics review"));
add(P([pending("obtain an ethics/IRB review (or a documented waiver) before submission and state the reference number here")]));
add(H2("10.6 Conflict of interest"));
add(P("The author is employed by Algo Analytica, which develops Brahmastra, a commercial electoral-intelligence and campaign-operations platform that ingests the output of the pipeline described here. No part of this paper reports on that product’s use by any customer, and no customer data was used."));

// ---------- 11 LIMITATIONS ----------
add(H1("11. Limitations"));
add(bullet([run("Benchmark size. ", { bold: true }), run("The field-level evaluation rests on one page of 30 cards and the transliteration evaluation on 113 names from one district. Both must be enlarged, with a second annotator, before the accuracy claims can be generalised (Section 4.3).")]));
add(bullet([run("Template sensitivity. ", { bold: true }), run("Section 6.7 shows that a roll printed in an unseen layout produces a high flag rate. The pipeline fails loudly rather than silently, but it does fail.")]));
add(bullet([run("Coverage. ", { bold: true }), run("The corpus covers four states and the audit results are pending supplements; nothing here describes India as a whole.")]));
add(bullet([run("Deletions are not wrongs. ", { bold: true }), run("A deletion record says that an elector was removed, not why, nor whether the removal was correct. The audit can locate concentrations that merit scrutiny; it cannot adjudicate them.")]));
add(bullet([run("Household reconstruction. ", { bold: true }), run("House numbers in rural rolls are noisy and sometimes denote compounds; household-level indicators are therefore indicative.")]));

// ---------- 12 CONCLUSION ----------
add(H1("12. Conclusion and future work"));
add(P("India’s electoral rolls are published in a form that is open in law and closed in practice. We have shown that a pipeline running on a commodity CPU, with no paid model, can read them accurately enough for booth-level aggregate audit and can report its own uncertainty, and we have set out the indicators by which a Special Intensive Revision can be audited once draft, final roll and supplements are in hand. The answer to RQ1 is yes, within the limits of the current benchmark; to RQ2, that consensus and field-specific passes remove most of the single-pass error and that the flags catch most of what remains; RQ3 awaits the supplements. Future work is, first, the enlarged benchmark and per-component ablation; second, completing the audit on the Uttar Pradesh and Karnataka rolls as their supplements are published; third, linking roll change to booth-level turnout and results (Form 20), which the same infrastructure already holds; and fourth, templates and transliteration for Marathi, Telugu and Kannada rolls."));

// ---------- BACK MATTER ----------
add(H1("Acknowledgements"));
add(P("[To be completed.]"));
add(H1("Author contributions (CRediT)"));
add(P("[Author]: conceptualisation, software, data curation, methodology, validation, visualisation, writing – original draft."));
add(H1("Funding"));
add(P("This research received no external funding. [Amend if applicable.]"));
add(H1("Data and code availability"));
add(P("The pipeline (downloader, OCR, consensus and transliteration engine), the benchmark page in pixelated form, the held-out transliteration set and the scripts that produce every figure in this paper are available at [repository URL]. Extracted roll data are not released (Section 10.2). Source PDFs are public on the ECI CDN at the URL patterns given in Section 4.1."));

add(H1("References"));
const refs = [
  "Election Commission of India. Order on Special Intensive Revision of Electoral Rolls, No. 23/2025-ERS (Vol. II), 24 June 2025.",
  "Election Commission of India. Press notes on the Special Intensive Revision, Bihar, August–September 2025. [Verify exact titles and dates.]",
  "R. Smith. An overview of the Tesseract OCR engine. Proc. ICDAR, 2007, pp. 629–633.",
  "M. Li, T. Lv, J. Chen, et al. TrOCR: Transformer-based optical character recognition with pre-trained models. Proc. AAAI, 2023.",
  "G. Kim, T. Hong, M. Yim, et al. OCR-free document understanding transformer. Proc. ECCV, 2022.",
  "B. Roark, L. Wolf-Sonkin, C. Kirov, et al. Processing South Asian languages written in the Latin script: the Dakshina dataset. Proc. LREC, 2020.",
  "Y. Madhani, S. Parthan, P. Bedekar, et al. Aksharantar: Open Indic-language transliteration datasets and models for the next billion users. Findings of EMNLP, 2023.",
  "W. B. Lund and E. K. Ringger. Improving optical character recognition through efficient multiple system alignment. Proc. JCDL, 2009.",
  "T. T. H. Nguyen, A. Jatowt, M. Coustaty and A. Doucet. Survey of post-OCR processing approaches. ACM Computing Surveys 54(6), 2021.",
  "S. Ansolabehere and E. Hersh. Validation: What big data reveal about survey misreporting and the real electorate. Political Analysis 20(4), 2012, pp. 437–459.",
  "S. Goel, M. Meredith, M. Morse, D. Rothschild and H. Shirani-Mehr. One person, one vote: Estimating the prevalence of double voting in U.S. presidential elections. American Political Science Review 114(2), 2020, pp. 456–469.",
  "Government of India. The Representation of the People Act, 1950, and the Registration of Electors Rules, 1960.",
  "Government of India. The Digital Personal Data Protection Act, 2023 (No. 22 of 2023).",
  "U. Ramer. An iterative procedure for the polygonal approximation of plane curves. Computer Graphics and Image Processing 1(3), 1972; D. Douglas and T. Peucker, Cartographica 10(2), 1973.",
];
refs.forEach((r, i) => body.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 400, hanging: 400 }, children: [run(`[${i + 1}] ${r}`, { size: 20 })] })));
add(P([run("Note: ", { bold: true, size: 20 }), run("reference details, especially [1]–[2], must be checked against the primary documents before submission.", { size: 20, italics: true })]));

// ---------- APPENDICES ----------
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("Appendix A. Roll page and cover layout"));
add(figure("fig1b_cover_redacted.png", "Figure A1. Cover page of a part PDF (pixelated). The top block identifies state, constituency and part; the middle block lists the administrative units; the bottom block gives polling-station details and elector counts.", 3.4));
add(H1("Appendix B. Annotation guidelines for the benchmark"));
add(P("Render the page at 300 dpi. Transcribe every field exactly as printed, including leading zeros, punctuation in house numbers and the roll’s own spelling of a name even if inconsistent with the same name elsewhere. Serial is the grid position. Record the relation type as printed (पिता/माता/पति) and gender as printed. Do not consult the OCR output while annotating. A second annotator repeats the page; disagreements are resolved by a third reading of the image."));
add(H1("Appendix C. Flag taxonomy"));
add(table(["Flag", "Meaning"],
  [["low_confidence", "card confidence below the threshold (default 0.70)"],
   ["epic_low_conf / name_low_conf / relation_name_low_conf / age_gender_low_conf", "the field’s vote was not unanimous or its confidence was low"],
   ["epic_invalid", "EPIC does not match the ECI format"],
   ["epic_autocorrected", "majority vote changed the plurality EPIC read"],
   ["epic_unreadable / name_unreadable / age_unreadable / gender_unreadable / relation_unreadable", "no usable read for the field"],
   ["name_missing / age_missing", "field not found in the card"],
   ["name_hi_corrected / relation_name_hi_corrected", "consensus repaired a one-edit defect towards a trusted token (original kept in log)"],
   ["serial_corrected", "serial read disagreed with grid order; grid order used"],
   ["serial_gap", "a serial is missing from the sequence on the page"],
   ["page_no_mismatch", "printed footer page number disagrees with PDF page index"],
   ["age_under_18 / age_out_of_range", "age read is impossible for an elector"]],
  [2.6, 4], "Table C1. Flags written to the _flag_reason column."));
add(H1("Appendix D. Transliteration rules and examples"));
add(P("Schwa deletion: सुरेश → Suresh, कमला → Kamla, रामचंद्र → Ramchandra. Aspirates: छ → chh, ख → kh, श/ष → sh. Long vowels without diacritics: ी → i or ee by learned context; ू → u or oo. Nasals: anusvara before a stop takes the homorganic nasal (चंद्र → Chandra). Overrides: exact tokens whose conventional spelling is not derivable (e.g. खान → Khan)."));
add(H1("Appendix E. Per-constituency result tables"));
add(P([pending("to be generated by the audit scripts once supplements are processed")]));
add(H1("Appendix F. Software versions and hardware"));
add(P("Node.js 22.17; Tesseract 5 with tessdata_best hin and eng models; Poppler pdftoppm; sharp 0.35; pipeline commit [hash]. Runs reported in Section 6 were executed on a laptop-class macOS machine; the deployment target is a 2-vCPU, 4-GB Linux server."));
add(H1("Appendix G. Reproducibility checklist"));
add(bullet("Benchmark page JSON and ocr-eval command: npm run build && node dist/cli.js ocr-eval"));
add(bullet("Transliteration scores: npm run translit:eval, with --rules-only and --no-lexicon"));
add(bullet("Large-scale run summary: output/<State>/<AC>/<AC>.summary.json"));
add(bullet("Figure scripts: make_figs.py (reads only the files above)"));

// ---------- DOCUMENT ----------
const doc = new Document({
  creator: "Algo Analytica",
  title: "Making the Invisible Roll Visible",
  styles: { default: { document: { run: { font: FONT, size: 22 } } } },
  numbering: { config: [{ reference: "bul", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 540, hanging: 270 } } } }] }] },
  features: { updateFields: true },
  sections: [{
    properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 })] })] }) },
    children: body,
  }],
});
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(__dirname + "/paper.docx", b); console.log("written", b.length); });
