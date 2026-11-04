// Builds Making_the_Invisible_Roll_Visible.docx. Every number in the text comes from
// data/gbn_stats.json (booth-level aggregates) or the benchmark commands; run make_figs.py first.
const fs = require("fs");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, ImageRun, BorderStyle, ShadingType, LevelFormat, PageBreak, TableOfContents, Footer, PageNumber,
} = require("docx");

const FIG = __dirname + "/figures/";
const sizes = JSON.parse(fs.readFileSync(FIG + "sizes.json"));
const ST = JSON.parse(fs.readFileSync(__dirname + "/data/gbn_stats.json"));
const A = ST.acs, D = ST.district, J = ST.jewarRun, P = ST.press, C = ST.corpus, B = ST.benchmark, T = ST.translit;
const ACS = ["61", "62", "63"];
const FONT = "Times New Roman";
const PAGE_W = 11906 - 2 * 1440; // A4 minus 1" margins, DXA

// ---------- numbers ----------
const n = (x) => Number(x).toLocaleString("en-US");
const pct = (a, b, d = 1) => (100 * a / b).toFixed(d) + "%";
const sum = (f) => ACS.reduce((s, ac) => s + f(A[ac]), 0);
const hours = (ms) => (ms / 3.6e6).toFixed(1);
const lakh = (x) => (x / 1e5).toFixed(2) + " lakh";
const unreadGender = (a) => (a.gender[""] || 0) + (a.gender["O"] || 0);
const nonconfEpic = (a) => (a.epicPat.other || 0) + (a.epicPat["3L6D"] || 0) + (a.epicPat["2L"] || 0) + (a.epicPat.empty || 0);
const gbnPreSir = Math.round(447000 / 0.2398);
const boothSR = (ac) => A[ac].perPart.filter((p) => p.m > 50 && p.f > 0).map((p) => 1000 * p.f / p.m).sort((x, y) => x - y);
const boothMedianSR = (ac) => { const v = boothSR(ac); return Math.round(v[Math.floor(v.length / 2)]); };
const netDecline = 100 * (1 - D.rows / gbnPreSir);

// ---------- helpers ----------
const run = (t, o = {}) => new TextRun({ text: t, font: FONT, size: 22, ...o });
const P_ = (t, o = {}) => new Paragraph({ spacing: { after: 120, line: 276 }, alignment: AlignmentType.JUSTIFIED, children: Array.isArray(t) ? t : [run(t)], ...o });
const H1 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 160 }, children: [run(t, { bold: true, size: 28 })] });
const H2 = (t) => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [run(t, { bold: true, size: 24 })] });
const bullet = (t) => new Paragraph({ numbering: { reference: "bul", level: 0 }, spacing: { after: 60 }, children: Array.isArray(t) ? t : [run(t)] });
const caption = (t) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 80, after: 240 }, children: [run(t, { size: 20, italics: true })] });
const b = (t) => run(t, { bold: true });

function figure(file, cap, widthIn = 5.8) {
  const [w, h] = sizes[file];
  const wpx = Math.round(widthIn * 96), hpx = Math.round(wpx * h / w);
  return [
    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 200 }, keepNext: true, children: [new ImageRun({ type: "png", data: fs.readFileSync(FIG + file), transformation: { width: wpx, height: hpx } })] }),
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
const name = (ac) => `${ac} ${A[ac].name}`;

// =====================================================================
// TITLE
// =====================================================================
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 600, after: 200 }, children: [run("Making the Invisible Roll Visible: Consensus OCR for Hindi Electoral Rolls and a Booth-Level Reading of Gautam Buddh Nagar after the Special Intensive Revision", { bold: true, size: 32 })] }));
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 }, children: [run("Syed Md Furquan", { size: 24 })] }));
add(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 }, children: [run("smfurquan0712@gmail.com", { size: 20, color: "555555" })] }));

add(H2("Abstract"));
add(P_(`Electoral rolls decide who may vote, and in many democracies the roll, or statistics drawn from it, can be obtained as data: the voter files of most American states are released as records, and a research literature on registration quality and purges has grown on them. India, with the largest electorate in the world, publishes its rolls as image-only PDFs, public in law and unreadable by machine. The gap matters most when the roll changes most. In 2025–26 the Election Commission of India carried out a Special Intensive Revision (SIR) that re-enumerated every elector; in Uttar Pradesh alone the roll went from 15.44 crore electors to a draft of 12.56 crore and a final roll of 13.40 crore, and the question of who was removed and who added was argued in the press and the courts on the Commission's own aggregate figures, because no one outside it could count. This paper shows how to count. We describe an open pipeline that reads the scanned Hindi rolls on an ordinary CPU, with no paid model and no network call during recognition. It combines multi-pass Tesseract recognition with per-field voting, page- and document-level consensus on Devanagari names, a cross-document name memory and a local Hindi-to-Roman transliteration engine, and it flags uncertain cards instead of guessing. We apply it to the complete SIR final roll of one district, Gautam Buddh Nagar (Noida, Dadri and Jewar): ${n(D.parts)} polling-station parts, ${n(C.pages)} pages, ${n(D.rows)} electors. On a hand-checked page the pipeline reads EPIC numbers, age, gender and relation without error and names with one error in thirty, 27 of 30 cards fully correct against 18 of 30 for single-pass Tesseract; across the district the rows read account for ${pct(sum((a) => a.rows), sum((a) => a.maxSerialSum))} of the printed serial numbers, and the sex ratio as read, ${D.sexRatio} women per 1,000 men, matches the Commission's published state figure of ${P.stateSexRatio}. Read as an auditor would, the final roll shows ${n(D.added)} electors (${pct(D.added, D.rows)}) added after the draft, spread over ${pct(sum((a) => a.sectionsWithAdd), sum((a) => a.sections), 0)} of localities and young (${pct(A["63"].added18_29, A["63"].action.added, 0)} of Jewar's additions are aged 18–29); a few booths that gained a quarter or more of their electors; and a small number of electors who still appear twice. It also shows what the final roll cannot establish: deletions, which can be measured only against the draft. We argue that image-only publication neither protects electors nor informs the public, and set out the aggregate statistics the Commission could release instead.`));
add(P_([b("Keywords: "), run("electoral rolls; optical character recognition; Devanagari; transliteration; election integrity; Special Intensive Revision; Uttar Pradesh; computational social science; document AI")]));

add(new Paragraph({ children: [new PageBreak()] }));
add(new Paragraph({ children: [run("Contents", { bold: true, size: 26 })], spacing: { after: 160 } }));
add(new TableOfContents("Contents", { hyperlink: true, headingStyleRange: "1-2" }));
add(new Paragraph({ children: [new PageBreak()] }));

// =====================================================================
// 1 INTRODUCTION
// =====================================================================
add(H1("1. Introduction"));
add(H2("1.1 Background and motivation"));
add(P_("The electoral roll is the one document that decides who may vote. In India it is prepared and revised under the Representation of the People Act, 1950 and published by the Election Commission of India (ECI) for every assembly constituency (AC), one “part” per polling station. In 2025 the Commission began a Special Intensive Revision (SIR) of the rolls, first in Bihar and then in a second phase that included Uttar Pradesh. In Uttar Pradesh the roll held 15.44 crore electors on 27 October 2025; the draft roll published on 6 January 2026 carried 12.56 crore, with 2.89 crore names (18.70%) not carried forward because the elector was recorded as deceased, absent or shifted, or enrolled more than once; the final roll published on 10 April 2026 carried 13.40 crore [1, 2]. A revision of this scale raised, in the press and in the courts, the question of who had been removed and who added, and whether the changes were evenly spread."));
add(P_("Answering that question requires reading the roll. The Commission does publish it, on a public content-delivery network, as one PDF per part. Every page of those PDFs is a rasterised image: there is no text layer, no table structure and no structured download. The roll is public in the legal sense and opaque in the practical sense. For the district studied here, that is " + n(D.parts) + " PDF files and " + n(C.pages) + " pages of scanned Hindi print."));
add(H2("1.2 Problem statement"));
add(P_("Three properties of these documents make them hard for off-the-shelf tools. The script: the rolls are printed in Devanagari, for which commodity OCR is markedly weaker than for Latin text, and in which one dropped halant or one confusable consonant pair (ब/व, थ/ध) changes a name. The scale: a single district is tens of thousands of pages, and a state is millions, which puts a vision-language model priced per page out of reach for most civil-society or academic budgets. The stakes: an audit built on noisy extraction may itself mislead, so the extraction has to know, and say, when it is unsure."));
add(H2("1.3 Research questions"));
add(bullet([b("RQ1. "), run("Can a low-cost, CPU-only pipeline recover the content of scanned Hindi electoral rolls accurately and completely enough to support a booth-level audit?")]));
add(bullet([b("RQ2. "), run("How much do multi-pass voting, page- and document-level consensus and cross-document name memory improve on single-pass OCR, and does the pipeline's own uncertainty flagging capture the errors that remain?")]));
add(bullet([b("RQ3. "), run("What does the final SIR roll of one district reveal about the revision: how many electors were added and modified, who they are, how the booths differ, and what the final roll cannot show?")]));
add(H2("1.4 Contributions"));
add(bullet([b("C1. "), run("An open, reproducible pipeline (downloader, OCR, consensus and transliteration engine) that runs on a commodity CPU-only server with no API key and no network access during recognition, at about 12 CPU-seconds and well under 1 GB of memory per page (Sections 4–6).")]));
add(bullet([b("C2. "), run("An evaluation against hand-checked ground truth, with a single-pass baseline and a flag-calibration analysis, and an internal- and external-consistency evaluation on a complete district of " + n(D.rows) + " extracted records (Section 6).")]));
add(bullet([b("C3. "), run("A booth-level audit framework for roll revisions, with the indicators that a final roll alone supports computed for all " + n(D.parts) + " parts of the district, and the indicators that need the draft roll identified (Sections 7–8).")]));
add(bullet([b("C4. "), run("An ethical and legal framing for research on voter-roll data under the Digital Personal Data Protection Act, 2023 (Section 10).")]));
add(H2("1.5 Organisation"));
add(P_("Section 2 describes the roll and the revision; Section 3 reviews related work; Section 4 the data; Section 5 the pipeline; Section 6 its evaluation; Section 7 the audit framework and Section 8 its application to Gautam Buddh Nagar; Sections 9–12 discuss implications, ethics, limitations and future work."));

// =====================================================================
// 2 BACKGROUND
// =====================================================================
add(H1("2. Background"));
add(H2("2.1 India's electoral roll"));
add(P_("The roll is organised as State → Assembly Constituency → Part → Section → elector. A part corresponds to one polling station and in Uttar Pradesh typically holds 400 to 1,100 electors; a section is a locality within the part, a street, hamlet, sector or housing society. Each elector carries an EPIC (Electors Photo Identity Card) number, a name, a relation (father, mother or husband) and the relative's name, a house number, age and gender. The Commission publishes a draft roll, accepts claims and objections on prescribed forms (Form 6 for inclusion, Form 7 for objection or deletion, Form 8 for correction), and then publishes a final roll. Between publications, supplements list additions, deletions and modifications."));
add(H2("2.2 The Special Intensive Revision in Uttar Pradesh"));
add(P_("Unlike a routine summary revision, a SIR re-enumerates the whole electorate: every existing elector must be matched to an enumeration form, and electors who are not matched are not carried into the draft. For Uttar Pradesh the Commission's figures, as reported at each stage, were: 15,44,30,092 electors on the roll in force on 27 October 2025; a draft published on 6 January 2026 from which 2.89 crore names (18.70%) were not carried forward, of whom 46.23 lakh (2.99%) were recorded as deceased, 2.17 crore (14.06%) as absent or permanently shifted, and 25.47 lakh (1.65%) as enrolled more than once; and a final roll of 13,39,84,792 electors published on 10 April 2026, 84,28,767 more than the draft, with 834 women per 1,000 men and 17,63,360 electors (1.32%) aged 18–19 [1, 2]. For Gautam Buddh Nagar the press reported 4.47 lakh names (23.98%) not carried into the draft, among the highest district shares reported, and 19.33% net deletions at the final roll, behind Lucknow, Ghaziabad and Kanpur Nagar [2, 3]. These figures are the only published account of the revision at district level; they come from press reporting of Commission data, not from a document the public can recompute."));
add(H2("2.3 Anatomy of a roll PDF"));
add(P_("Figure 1 shows a representative page, pixelated for publication. A part PDF begins with a cover page (constituency and part identifiers, polling-station name and address, the administrative units from village to district, and the elector count and last serial number), followed by a grid of elector cards, three per row and ten per page, each boxed by a printed border. In the SIR final roll the electors added after the draft are printed in a separate list at the end of the part, with the same card layout, under an “additions” header; modified entries are marked in the serial box. Page headers carry the section number and name; footers carry the printed page number. Every one of these elements is image only."));
add(figure("fig1_roll_page_redacted.png", "Figure 1. A voter-card page from the Hindi SIR final roll (Dadri, part 794, page 3), pixelated so that no personal data is legible. Three cards per row, ten rows per page; each card prints an EPIC number (top right), name, relation and relative's name, house number, age and gender, and a serial number (top left).", 3.6));
add(H2("2.4 Legal and policy context"));
add(P_("Section 16 of the Representation of the People Act, 1950 and the Registration of Electors Rules, 1960 require the roll to be published and copies to be made available. The Digital Personal Data Protection Act, 2023 governs the processing of the personal data the roll contains; its exemption for publicly available personal data applies only where the data principal made the data public, which is not the case here. Research use must therefore be purpose-limited and minimised (Section 10). The Commission has said that image-only publication is meant to prevent bulk harvesting of elector data; Section 9.4 returns to whether it does."));

// =====================================================================
// 3 RELATED WORK
// =====================================================================
add(H1("3. Related work"));
add(H2("3.1 OCR for Indic scripts"));
add(P_("Tesseract 4 and 5 provide LSTM models for Hindi and most Indic scripts [4]; their accuracy on clean print is good and degrades sharply on low-resolution scans and conjunct-heavy text. Transformer recognisers such as TrOCR [5] and OCR-free document models such as Donut [6] improve on Tesseract for Latin text but have limited Indic training data and need a GPU. Indic-specific models and benchmarks (IndicOCR, the Bhashini initiative) are improving but remain uneven across scripts."));
add(H2("3.2 Vision-language models for forms"));
add(P_("Multimodal language models read structured forms well in zero-shot settings and the pipeline can use one as an optional second reader. Their drawbacks for this task are cost at the scale of millions of pages, latency, and a tendency to produce fluent but wrong values, such as the parliamentary constituency where the assembly constituency was asked for, with no signal of uncertainty."));
add(H2("3.3 Transliteration of Indian names"));
add(P_("Hindi-to-Roman transliteration is many-to-many: the same Devanagari name is written Sunil or Suneel, Vinod or Binod, by regional convention and by the data-entry operator who typed it. Large parallel corpora (Dakshina [7], Aksharantar [8]) support neural transliterators, but the spellings on identity documents follow their own conventions (no diacritics, “sh”, “chh”, schwa deletion as spoken), which is why we use rules, a learned re-ranker and a lexicon rather than a general model."));
add(H2("3.4 Multi-pass OCR and post-OCR correction"));
add(P_("Ensembling several OCR passes and voting on the output is a long-standing technique [9], as is lexicon-driven post-correction [10]. We apply both at the level of individual fields, with field-specific passes (digit whitelists for EPIC and age, Hindi-only passes for names), and add a consensus step that repairs a low-confidence name towards a trusted token only when the two differ by one edit of a kind Tesseract is known to make."));
add(H2("3.5 Computational studies of voter lists"));
add(P_("The most developed literature on voter-file quality is American: validation of self-reported turnout against voter files [11], matching of registrations across states and the error rates of such matching [12], and audits of purge lists. Indian work has largely relied on aggregate Commission statistics or on manual sampling of printed rolls, because the rolls have not been machine-readable at scale. Civic-technology projects have scraped individual rolls, but without a validated, open extraction method or a reported error rate."));
add(H2("3.6 Research gap"));
add(P_("We are not aware of a published, validated, open pipeline for Devanagari electoral rolls, nor of a complete booth-level reading of a district's SIR roll built on one. This paper provides both."));

// =====================================================================
// 4 DATA
// =====================================================================
add(H1("4. Data"));
add(H2("4.1 Source and collection"));
add(P_("All documents come from the Commission's public CDN. Each roll type follows a fixed URL pattern, for example /eroll/<year>/<state>/sir-finalroll/<ac>/<year>-EROLLGEN-<state>-<ac>-SIR-FinalRoll-Revision1-<lang>-<part>-WI.pdf, with analogous patterns for draft rolls and supplements. The downloader discovers which roll types exist for a constituency by probing part 1, finds the last part number by binary search on the main roll (about fifteen requests for an 800-part constituency), and then fetches each candidate file once; a 404 is the signal that a part does not exist. Files already on disk and valid are never re-requested; partial files are resumed; the client backs off on 406, 429 and 5xx responses and never retries a definitive 4xx. The part count is cross-checked against the Commission's own part list, which the portal serves through a public JSON endpoint (get-part-list) and which also supplies the official English name of every polling station; for all three constituencies the two counts agreed. Collection was throttled, identified itself, and took place between 20 and 30 October 2026."));
add(H2("4.2 The district and the corpus"));
add(P_("Gautam Buddh Nagar is the district south-east of Delhi that contains Noida and Greater Noida. Its three assembly constituencies run from dense urban (61 Noida, almost entirely sectors and housing societies) through mixed (62 Dadri, Greater Noida and its villages) to largely rural (63 Jewar, the site of the new international airport). That gradient is useful: the same pipeline, the same print template and the same month of publication, applied to three very different electorates. Table 1 summarises the corpus. Every part the Commission published was retrieved and read; no part is missing from the analysis."));
add(table(["Constituency", "Parts (official list = retrieved)", "Pages", "Size on disk", "Elector rows read", "Rows per part (median)", "Sections"],
  ACS.map((ac) => [name(ac), n(A[ac].parts), n(A[ac].pages), (A[ac].bytes / 1e9).toFixed(1) + " GB", n(A[ac].rows), n(A[ac].partSize.median), n(A[ac].sections)])
    .concat([["District", n(D.parts), n(C.pages), C.gb + " GB", n(D.rows), "", n(sum((a) => a.sections))]]),
  [1.5, 1.5, 1, 1.1, 1.3, 1.3, 1], "Table 1. The corpus: the SIR final roll (Revision 1, Hindi) of Gautam Buddh Nagar as published on the ECI CDN after 10 April 2026 and collected in October 2026. One part = one polling station = one PDF."));
add(H2("4.3 Ground-truth benchmark"));
add(P_("Field-level evaluation uses a hand-checked page: page 3 of part 794 of the Dadri roll, 30 cards, read by eye from the 300-dpi rendering and recorded as JSON. Every field of every card was transcribed: EPIC, name, relation type, relative's name, house number, age, gender and serial. The transliteration benchmark is a separate held-out set of 113 Devanagari names as Tesseract reads them from Dadri rolls, paired with the Roman spelling a data-entry operator would write; it is never used for training. Both sets are small, and Section 6.6 is our answer to that: with ground truth for only 30 cards, we lean on consistency checks that the whole corpus of " + n(D.rows) + " rows can be subjected to."));
add(H2("4.4 What the corpus does not contain"));
add(P_("Only the final roll was collected. The draft roll of 6 January 2026 and the Commission's supplement lists were not retrieved, so electors who were on the draft and are absent from the final roll cannot be identified by us; Section 8.6 sets out what this means for the audit. The corpus is one district of one state, chosen because it was the first for which every part had been collected and read with a single print template; nothing here describes Uttar Pradesh or India as a whole."));

// =====================================================================
// 5 PIPELINE
// =====================================================================
add(H1("5. Methodology I: the extraction pipeline"));
add(figure("fig2_pipeline.png", "Figure 2. The pipeline. Every stage runs locally; the optional hybrid engine sends only flagged cards to a vision model and was not used for the runs reported here.", 6.2));
add(H2("5.1 Overview"));
add(P_("Figure 2 shows the stages. A folder of PDFs is processed a few files at a time, one page at a time; the result of every page is cached by content hash so that interrupted runs resume. The pipeline is written in TypeScript and calls Tesseract 5 and Poppler as subprocesses, with libvips (through sharp) for cropping and scaling; it has no other runtime dependency and needs no GPU. A watch mode polls a folder, reads each new PDF and, when configured, pushes its rows part by part into a dashboard through an ingest API, so that a constituency becomes queryable as it is read rather than when it is finished."));
add(H2("5.2 Pre-processing and page classification"));
add(P_("Pages are rendered at 300 dpi with pdftoppm. Page 1 is treated as a cover unless it lacks cover vocabulary. For every other page the strip above the first card is read and classified as main roll (header “अनुभाग संख्या और नाम : 1-…”), additions, deletions, modifications, summary or other. An unreadable header on a page that carries a card grid is assumed to be a main-roll page and a warning is logged; in the Jewar run this happened on 21 of " + n(J.pages) + " pages."));
add(H2("5.3 Cover-page parsing"));
add(P_("The cover is OCR'd in full and the state, constituency number and name, part number, year, draft/final status, dates, the elector count and the last serial number are extracted with regular expressions and cross-checked against the file name, which encodes state, constituency, roll type, language and part. The administrative-unit box (village or town, ward, post office, police station, panchayat, block, tehsil, district, PIN) is located from its label words and re-read at 2× scale; the PIN is read with a digit-only whitelist. The polling-station name is read from the cover in Hindi and transliterated, but where the Commission's part list is on file its official English name is used instead: a transliteration such as “Amichand Intar Kalej Kasna Kamra 1” becomes “AMICHAND INTER COLLEGE KASNA ROOM NO. 1”. Of the " + n(D.parts) + " parts, 19 covers in Jewar yielded no station name at all and were named from the list."));
add(H2("5.4 Layout analysis"));
add(P_("Card rectangles are found from the printed borders: horizontal and vertical ink profiles locate the ten row bands and three columns, giving up to 30 rectangles per page in reading order. Within each card the serial box and the section box are located from their own borders, so the detector is independent of print size. When row detection fails on a page the template's nominal grid is used and a warning is logged (52 pages in Jewar). Bordered cells that contain nothing voter-like, such as the totals table at the end of a list, are dropped."));
add(P_("The detector works on ink profiles and makes no assumption about print size. Pixels darker than 140 of 255 are counted along every row of the page; a horizontal rule is a run of rows in which at least half the width is dark and which is no thicker than 0.4% of the page height, so that the heavy edges of the photograph box are not taken for rules. Rules are paired into card bands by the gap between them: the 90th percentile of all gaps is taken as the card pitch, and a pair counts as a band if its gap lies between 0.6 and 1.6 times that pitch. Three checks reject a false grid: at most eleven bands, every band within ±25% of the median height, and the median within 0.6–1.5× of the nominal row height; the third is what stops the totals table on the last page of a list being read as a row of cards. A second, sparser pass with a 12% fill threshold and hairlines only recovers a last row that holds a single card, and a trailing partial row is sought one pitch below the last band. Columns are found the same way from vertical rules that are dark over at least 85% of the band, because the photograph box spans about 60% of it and would otherwise be found instead. Within a card the serial and section boxes are located from their own borders; the crop is inset by 6–7% of the box height because a border row left in the crop turns a 2 into a 1, and is upscaled 1×, 2× or 3× according to the box height so that the digits are 60–100 px tall when Tesseract sees them. The template geometry of three columns by ten rows, with field boxes as fractions of the card, is used only when detection fails, and templates inherit: Uttar Pradesh extends the default; Andhra Pradesh and Maharashtra extend Goa with a wider body box."));
add(H2("5.5 Field recognition"));
add(bullet([b("EPIC. "), run("The EPIC box is read three times with the English model and an alphanumeric whitelist, at 1×, 2× and 3× scale with binarisation, and the reads are majority-voted character by character. An EPIC that fails the format check (three letters and seven digits, or the legacy form with slashes such as UP/77/387/0549188) is flagged epic_invalid; a vote that changed the plurality read is recorded as epic_autocorrected.")]));
add(bullet([b("Serial. "), run("The serial box is read as digits and as letters-plus-digits so that modification markers are captured. On main-roll and addition pages the serial is cross-checked against grid order; a disagreement is resolved towards grid order and flagged serial_corrected.")]));
add(bullet([b("Names and labels. "), run("The card body is read once with the bilingual eng+hin model (labels, digits) and once with the Hindi-only model at 2× (names). Fields are located by fuzzy matching of their printed labels. The two name reads are voted: a read containing Latin garbage is dropped, and the higher-confidence read wins otherwise.")]));
add(bullet([b("Age, gender, relation. "), run("The age line is re-read at 3× with a digit whitelist when the first read is uncertain; gender and relation type are matched fuzzily against their small closed vocabularies (पुरुष/महिला/अन्य; पिता/माता/पति), allowing one edit for words of three letters or more.")]));
add(bullet([b("Confidence. "), run("Tesseract's word confidences are not taken at face value. A single EPIC read that fits the format, with no second read to confirm it, is capped at 75 of 100; a read that fits no format is capped at 50; two independent reads that agree add 5. Before the format check a seven-character EPIC tail is repaired by the fixed map O→0, I→1, L→1, S→5, B→8, Z→2, /→7 and accepted only if the result is seven digits, recorded as epic_autocorrected. Card confidence is the minimum over EPIC, name, relation and age/gender, so a card is only as trustworthy as its weakest field.")]));
add(H2("5.6 Consensus and error repair"));
add(P_("After a page is read, and again after a PDF is complete, a consensus pass repairs names. A Devanagari token read with low confidence that differs from a trusted token by exactly one edit of a kind Tesseract is known to make (a dropped or stray halant, nukta or anusvara; a swap between look-alike vowel signs such as े/ै, ो/ौ, ु/ू, ि/ी; or a swap between look-alike consonants such as ब/व, थ/ध, घ/ध, भ/म, श/ष, न/ण) is replaced by it and flagged name_hi_corrected, with the original read kept in the log. A trusted token is one read with confidence elsewhere on the same page or PDF, or present in the name lexicon. Matras are never dropped or added and consonants are never inserted, so a rare but real spelling (चन्दा, खुरशैद) survives as long as it was read with confidence."));
add(P_("The lexicon is built by a cross-document name memory. Tokens read with field confidence of at least 0.90, and not themselves a consensus repair, are recorded per PDF hash; a token joins the lexicon once it has been read confidently in two different PDFs. Re-running a PDF adds nothing and a PDF never confirms itself, so the memory improves new documents, not those it was learned from. By the end of the Jewar run the memory held 87,347 trusted tokens."));
add(H2("5.7 Transliteration"));
add(P_("Roman names are produced locally in three layers. Rules: Devanagari is syllabified and transliterated with schwa deletion as spoken (सुरेश → Suresh, कमला → Kamla, रामचंद्र → Ramchandra), nasal and conjunct rules, and the conventions of Indian identity documents (sh, chh, kh; no diacritics). A learned re-ranker: for each syllable the rules enumerate the spellings it may take (ी → i or ee, व → v or w, inherent a kept or dropped); training aligns each of 1,905 seed pairs to those alternatives and counts which was used in which context (neighbouring syllables, word position), and at run time the alternatives are re-ranked by those counts, backing off to the rule where there is no evidence. An exact-match lexicon of attested tokens and a hand-maintained override table of 46 entries are applied first."));
add(H2("5.8 Uncertainty flagging"));
add(P_("The pipeline never drops a row. Every card is written with a per-card confidence and zero or more flags from a fixed taxonomy (Appendix C): low_confidence (card confidence below 0.70), the per-field *_low_conf flags, *_unreadable and *_missing, epic_invalid, epic_autocorrected, serial_corrected, serial_gap, page_no_mismatch, age_under_18 and age_out_of_range. In the hybrid engine, cards whose Tesseract confidence is below 0.85 are sent to a vision model for a second read; in the local engine used here they are simply flagged."));
add(H2("5.9 Merge, cross-checks and push"));
add(P_("All PDFs of a folder are merged into one CSV; every row records which list it came from (Action_status: existing, added, deleted, modified; Supplement_no). Two cross-checks run per part: the number of main-roll cards read is compared with the elector count printed on the cover, and the highest serial read is compared with the number of rows. A summary (JSON and text) records per-PDF card and page counts, flag counts and warnings. With push enabled, each finished part replaces its own earlier rows in the dashboard, so a re-read of one part never disturbs another."));
add(H2("5.10 Engineering for a CPU-only server"));
add(P_("Tesseract is almost the whole of the recognition cost, and the pipeline is organised around how it is called. A 30-card page needs about 300 crops (EPIC at three scales, serial twice, section twice, body twice, header and footer), and a Tesseract process takes about 60 ms to start, which called once per crop would be 18 s of start-up per page before any recognition. Instead each pass is written as a list file and run as one process over every card on the page, and the TSV output is split back per image by its page column: eleven processes per card page plus two for the header and footer, started together. Each process is held to one thread (OMP_THREAD_LIMIT=1), so that a page costs about one core and the number of pages in flight, governed by one semaphore shared across all the PDFs being processed, can be set to the number of cores and no more. The 300-dpi page is decoded once, in about 35 ms, and every crop is cut from the raw buffer with the density tag re-attached so that Tesseract sizes the text correctly; the page image is deleted as soon as its last pass returns. Memory is accordingly modest. On the server the Node process holds 1.1–1.3 GB resident and each Tesseract process 45–55 MB; on 4 November 2026 two independent jobs with six Tesseract processes between them were using 3.4 GB of the 16 GB, with no swap, at a load average of 15.5 on eight vCPUs, and between them were reading about 0.2 pages per second, the aggregate rate at which the Jewar run was measured."));
add(P_("Every PDF is identified by its SHA-256, which keys the result cache, the per-page cache, the scratch directory, the name memory's provenance and the push ledger. A page result is written the moment the page is finished, to a temporary file that is then renamed, as is every state file the pipeline writes, so a run killed at any point resumes with only the unfinished pages left to read; when the whole PDF is done its page files are folded into one record carrying a schema version, and a record of an older schema is re-read rather than trusted. Cached results are not frozen. Name cleaning, consensus against the current lexicon, official part names and transliteration are re-applied to cached rows on every run, so an improvement to the post-processing propagates to every roll already read without re-OCR, while an improvement to recognition itself, such as the one measured in Table 5, still requires a re-read. A corrupt or truncated PDF fails alone: Poppler's error is recorded against that file, the batch continues, and the exit code reports the failure at the end. Rendered pages are deleted as each page completes and the per-PDF scratch directory is removed whether the PDF succeeded or not, so disk use is bounded by the pages in flight."));
add(P_("The watch mode re-scans the root every 60–120 s and simply re-runs each constituency folder; its idempotence comes from the hash cache, not from file-system events, so a PDF copied in halfway is hashed, fails, and is picked up whole on the next pass. The push is phased: begin-part clears that part's rows of that source (the main roll or a numbered supplement, so that a supplement never wipes the main roll), parts carries the cover metadata, rows go in chunks of 5,000, and finish recomputes the roll's totals; there are four retries with exponential back-off capped at 30 s and none on a client error. The ledger entry (URL, PDF hash, part, source → hash of the rows) is written only after finish, so an interrupted push is repeated in full and a complete one never is, and the part's CSV is dropped only once the dashboard has confirmed receipt. Finally, the local engine is not a configuration that happens not to call a model: no vision client is constructed, the pipeline's client handle is null, and any code path that would reach for one throws; what the hybrid engine would escalate becomes a flag on the row. Ten unit-test suites (consensus, cover parsing, CSV, folder naming, voting, layout, merge, name memory, normalisation, transliteration) and the ocr-eval and translit-eval commands reproduce every accuracy figure in Section 6."));
add(H2("5.11 Implementation and resource footprint"));
add(P_("The runs reported here used a rented cloud server with 8 vCPUs (AMD EPYC Genoa), 16 GB of memory and no GPU, costing a few tens of euros a month, and a desktop Apple M4 machine with 10 cores. The pipeline makes no network call during recognition; the only network traffic is the download of the PDFs and, optionally, the push of finished rows to a dashboard. The Jewar roll (" + n(J.pdfs.total) + " parts, " + n(J.pages) + " pages, " + n(J.rows) + " rows) was read in one run of " + hours(J.durationMs) + " hours on the server while it shared the machine with a second OCR job, at " + J.pagesPerSec + " pages per second; a constituency of this size is therefore an overnight job and a district is a long weekend, at a marginal cost that rounds to zero. Noida and Dadri were read between 17 and 30 October 2026, partly on the desktop machine and partly on the server, with the builds of the pipeline current at the time; Jewar was re-read from scratch on 1 November 2026 with the final build, and is the run whose logs Section 6 reports in detail."));

// =====================================================================
// 6 EVALUATION
// =====================================================================
add(H1("6. Evaluation of the pipeline (RQ1, RQ2)"));
add(H2("6.1 Setup"));
add(P_("We report field accuracy (a field is correct when it matches the ground truth exactly after whitespace normalisation), card accuracy (all fields correct), and flag calibration (of the cards with an error, how many carry a flag; of the flagged cards, how many are in fact wrong). The baseline is a single Tesseract pass (eng+hin, page segmentation mode 3) over the whole 300-dpi page; a baseline field counts as correct if the ground-truth string occurs verbatim in the page text, which is generous to the baseline because it ignores the problem of assigning text to cards. All measurements were re-run for this paper with the shipped ocr-eval and translit-eval commands on 4 November 2026."));
add(H2("6.2 Field- and card-level accuracy"));
add(table(["Field", "Single-pass Tesseract", "Consensus pipeline", "Residual error (pipeline)"],
  [["EPIC number", `${B.baseline.epic}/30 (${pct(B.baseline.epic, 30, 0)})`, `${B.epic}/30 (100%)`, "—"],
   ["Name (Devanagari)", `${B.baseline.name}/30 (${pct(B.baseline.name, 30, 0)})`, `${B.name}/30 (97%)`, "बिट्टो read as विट्रो (two defects in one token; flagged)"],
   ["Relation type", "—", `${B.rel}/30 (100%)`, "—"],
   ["Relative's name", `${B.baseline.relName}/30 (${pct(B.baseline.relName, 30, 0)})`, `${B.relName}/30 (97%)`, "खुरशैद normalised to खुरशेद by consensus (flagged, original kept)"],
   ["House number", "—", `${B.house}/30 (97%)`, "“.2” read as “2” (not flagged)"],
   ["Age", "30/30 (100%)", `${B.age}/30 (100%)`, "—"],
   ["Gender", "—", `${B.gender}/30 (100%)`, "—"],
   ["Card fully correct", `${B.baseline.card}/30 (${pct(B.baseline.card, 30, 0)})*`, `${B.fullyCorrect}/30 (90%)`, "3 cards; 2 of them flagged"]],
  [1.5, 1.4, 1.4, 2.6], "Table 2. Accuracy on the hand-checked Dadri page (30 cards). *Baseline card accuracy counts EPIC, name and relative's name only, the three fields the baseline can be scored on, and is therefore an upper bound."));
add(figure("fig3_accuracy_vs_baseline.png", "Figure 3. Correct cards per field on the hand-checked page: single-pass Tesseract against the consensus pipeline. *Card-level for the baseline covers EPIC, name and relative's name only.", 4.8));
add(P_("The pipeline removes every EPIC error and five of the six name errors made by the single pass. The three residual card errors are instructive. One is a name with two defects in one token, which the single-edit consensus rule deliberately does not repair. One is the roll's own inconsistent spelling of a name (खुरशैद beside खुरशेद) being normalised towards the more frequent form. One is a house number whose leading full stop was lost. The first two carry flags; the third does not, and is the only silent error on the page."));
add(H2("6.3 Flag calibration"));
add(figure("fig4_flag_calibration.png", `Figure 4. Flag calibration on the hand-checked page. Of 30 cards, ${B.flagged} are flagged for review; ${B.wrongFlagged} of those contain an error. One erroneous card (a lost full stop in a house number) is not flagged.`, 4.6));
add(P_(`Twelve of 30 cards were flagged. Two of the three erroneous cards are among them (recall 0.67 at card level; both name errors are caught, the house-number error is not), and ${B.flagged - B.wrongFlagged} of the ${B.flagged} flagged cards are in fact correct (precision 0.17). The flags are therefore conservative: a reviewer who checks every flagged card will see mostly correct cards, and will catch nearly every field that matters for identity. For an audit that is the right trade-off, and it is tunable through the confidence threshold.`));
add(H2("6.4 Transliteration"));
add(table(["Configuration", `Exact match (${T.n} held-out names)`, ""],
  [["Rules only", `${T.rules}/${T.n}`, pct(T.rules, T.n)], ["Rules + learned re-ranker (no lexicon)", `${T.model}/${T.n}`, pct(T.model, T.n)], ["Full engine (re-ranker + lexicon + overrides)", `${T.full}/${T.n}`, pct(T.full, T.n)]],
  [3, 2, 1.2], "Table 3. Hindi → Roman transliteration accuracy. The held-out set is not used for training; the lexicon is built from the seed corpus only."));
add(figure("fig5_translit_ablation.png", "Figure 5. Transliteration accuracy by configuration on the held-out set.", 4.2));
add(P_("The rule-only errors are conventions rather than phonetic mistakes: सिंह → Sinh for Singh, धीर → Dheer for Dhir, फिरोज → Firoj for Firoz, आजाद → Ajad for Azad. The re-ranker learns most of these from context and the lexicon closes the rest. A perfect score on 113 names from one district says little about other regions, whose Roman conventions differ, and we do not claim more than that."));
add(H2("6.5 Throughput and cost"));
add(table(["Engine", "Model calls", "Jewar roll (" + n(J.pages) + " pages)", "Marginal cost"],
  [["local (this paper)", "none", hours(J.durationMs) + " h on 8 shared vCPUs; " + J.pagesPerSec + " pages/s", "nil beyond the server"],
   ["hybrid", "flagged cards only (" + pct(J.flaggedRows, J.rows, 0) + " of rows in Jewar)", "local time plus API latency", "a few cents per part"],
   ["llm (every page in strips)", "about 3 per page", "API-bound", "highest"]],
  [1.5, 2.2, 2.4, 1.4], "Table 4. Resource footprint of the three engines. The local figures are measured on the Jewar run; the hybrid and llm figures are design properties and were not benchmarked at scale for this paper."));
if (ST.scaling) {
  const S = ST.scaling, s1 = S.rows[0];
  const cores = (r) => (r.user_s + r.sys_s) / r.wall_s, cpuPerPage = (r) => (r.user_s + r.sys_s) / r.pages;
  add(table(["Pages in flight", "Wall time (s)", "Pages / s", "Cores busy (mean)", "CPU-seconds per page", "Peak memory (MB)"],
    S.rows.map((r) => [String(r.conc), r.wall_s.toFixed(0), r.pages_per_s.toFixed(3), cores(r).toFixed(1), cpuPerPage(r).toFixed(1), n(r.max_rss_mb)]),
    [1.5, 1.3, 1.1, 1.5, 1.6, 1.4], "Table 4b. Throughput against the number of pages processed in parallel, on the same " + S.pages + " pages of " + S.pdfs + " roll PDFs (" + n(S.rows_read) + " cards), local engine, otherwise idle " + S.machine + " (10 cores). Cores busy is CPU time divided by wall time; peak memory is the maximum resident set of the whole process tree."));
  add(figure("fig13_scaling.png", "Figure 13. Pages per second against pages in flight on the " + S.machine + " (4 performance and 6 efficiency cores). The dashed line is linear scaling from the single-page rate; with one page in flight the passes of that page already occupy about " + cores(s1).toFixed(0) + " cores, and the rate saturates once the performance cores are busy.", 4.6));
  const last = S.rows[S.rows.length - 1], best = S.rows.reduce((a, r) => r.pages_per_s > a.pages_per_s ? r : a, s1);
  add(P_("Table 4b measures the claim that the pipeline is a CPU job and nothing more, and it also shows the limit of that claim on a desktop. With one page in flight the thirteen passes of that page already keep about " + cores(s1).toFixed(0) + " cores busy, because they run together, and a page costs " + cpuPerPage(s1).toFixed(0) + " CPU-seconds. Throughput rises to " + best.pages_per_s.toFixed(2) + " pages per second with " + best.conc + " pages in flight and then stops rising: the M4 has four performance cores and six efficiency cores, and once the fast cores are busy the extra pages run on slow ones, so the CPU-seconds per page climb to " + cpuPerPage(last).toFixed(0) + " while the pages per second do not move. The lesson, which the server settings of Section 5.11 had reached by trial, is to set the number of pages in flight to the number of fast cores and no higher; the server's two processes with four pages each on eight homogeneous vCPUs read about 0.2 pages per second between them, which is the same work per core as the desktop's four performance cores. Peak memory moves from " + n(s1.max_rss_mb) + " MB to " + n(last.max_rss_mb) + " MB across the whole range, so the job fits many times over in the memory of a small server, and the binding resource is CPU alone. At " + best.pages_per_s.toFixed(2) + " pages per second a constituency of 420 parts and 12,000 pages is about " + (12000 / best.pages_per_s / 3600).toFixed(0) + " hours and a district of 59,000 pages about " + (59000 / best.pages_per_s / 3600 / 24).toFixed(0) + " days on one such machine; a second machine, or a server with more fast cores, halves that, since parts are independent."));
}
add(H2("6.6 Behaviour at scale: internal consistency on " + n(D.parts) + " parts"));
add(P_("A benchmark of 30 cards cannot speak for " + n(D.rows) + " rows. What can is a set of checks that every row or every part must pass if it was read correctly, and whose failure rate is therefore an upper bound on one class of error. We apply five."));
add(bullet([b("Completeness. "), run("The cards of a part are numbered consecutively, so the highest serial read in a part is the number of electors the part should contain. Figure 7 plots rows read against that figure for every part. In total the rows read account for " + pct(A["61"].rows, A["61"].maxSerialSum, 2) + " of the printed serial numbers in Noida, " + pct(A["62"].rows, A["62"].maxSerialSum, 2) + " in Dadri and " + pct(A["63"].rows, A["63"].maxSerialSum, 2) + " in Jewar; " + A["61"].shortParts98 + ", " + A["62"].shortParts98 + " and " + A["63"].shortParts98 + " parts respectively are short by more than 2%, and " + A["61"].shortParts90 + ", " + A["62"].shortParts90 + " and " + A["63"].shortParts90 + " by more than 10%. A part is short when a page's grid was not found or a card was dropped as “not voter-like”; those parts are known by number and can be re-read.")]));
add(bullet([b("EPIC format. "), run("A valid EPIC is three letters and seven digits, or the legacy form with slashes that older electors still carry. The share of rows whose EPIC fits neither pattern is an upper bound on the EPIC misread rate: " + ACS.map((ac) => pct(nonconfEpic(A[ac]), A[ac].rows, 2) + " in " + A[ac].name).join(", ") + ". Legacy EPICs are " + n(A["61"].epicPat.slash || 0) + " rows in Noida, " + pct(A["62"].epicPat.slash, A["62"].rows) + " of Dadri's rows and " + pct(A["63"].epicPat.slash, A["63"].rows) + " of Jewar's, which is itself a finding: the older, rural electorate still carries cards issued before the current numbering.")]));
add(bullet([b("Closed vocabularies. "), run("Gender and relation type are drawn from vocabularies of three words. A row with neither पुरुष nor महिला, or with no relation type, is a card the pipeline could not read. " + ACS.map((ac) => A[ac].name + ": gender unreadable " + pct(unreadGender(A[ac]), A[ac].rows, 2) + ", relation blank " + pct(A[ac].relation[""] || 0, A[ac].rows, 2)).join("; ") + ".")]));
add(bullet([b("Plausible ages. "), run("An elector is at least 18 on the qualifying date, so a row with an age below 18 is either a misread or a name that should not be on the roll, and we looked at every one. There are " + ACS.map((ac) => n(A[ac].ageLt18.total) + " in " + A[ac].name).join(", ") + " (" + ACS.map((ac) => pct(A[ac].ageLt18.total, A[ac].rows, 2)).join(", ") + "). They are not under-age electors. " + pct(sum((a) => a.ageLt18.zero), sum((a) => a.ageLt18.total)) + " of them carry an age of 0, which is the value the pipeline writes when the age cell could not be read at all, and " + pct(sum((a) => a.ageLt18.a1_9), sum((a) => a.ageLt18.total)) + " carry a single digit, the second digit of a two-digit age lost at the edge of the cell. An age between 10 and 17, the only range in which a real minor could hide, appears on " + n(sum((a) => a.ageLt18.a10_17)) + " rows in the whole district (" + ACS.map((ac) => A[ac].ageLt18.a10_17 + " in " + A[ac].name).join(", ") + "), and on exactly " + sum((a) => a.ageLt18.a17) + " rows at age 17; the final build, on Jewar, produced " + A["63"].ageLt18.a10_17 + ". Ages above 120 are rarer still: " + ACS.map((ac) => A[ac].ageLt18.gt120 + " in " + A[ac].name).join(", ") + ".")]));
add(bullet([b("Flags. "), run("In the Jewar run " + n(J.flaggedRows) + " rows (" + pct(J.flaggedRows, J.rows) + ") carry at least one flag (Figure 8). The commonest, epic_low_conf on " + pct(J.flagCounts.epic_low_conf, J.rows) + " of rows, means that the three EPIC reads were not unanimous, not that the vote was wrong; given the format-check rate above, the great majority of these are correct. Consensus repaired a name on " + pct(J.flagCounts.name_hi_corrected, J.rows) + " of rows and a relative's name on " + pct(J.flagCounts.relation_name_hi_corrected, J.rows) + "; grid order overrode a misread serial on " + pct(J.flagCounts.serial_corrected, J.rows) + ".")]));
add(figure("fig6_part_size.png", "Figure 6. Electors read per part. The dashed line is the median. The Commission's target is about 1,200 electors per polling station; parts of fewer than 300 are small villages and institutional booths.", 6.4));
add(figure("fig7_completeness.png", "Figure 7. Rows read from each part against the highest printed serial number in it, " + n(D.parts) + " parts. A part on the diagonal was read in full; a part below the dotted line is short by more than 2%.", 4.6));
add(figure("fig8_jewar_flags.png", "Figure 8. Flags raised on the " + n(J.rows) + " rows of the Jewar run. A row may carry several flags; " + n(J.flaggedRows) + " rows carry at least one.", 5.4));
add(table(["Check", name("61"), name("62"), name("63")],
  [["Rows read", n(A["61"].rows), n(A["62"].rows), n(A["63"].rows)],
   ["Sum of highest printed serials", ...ACS.map((ac) => n(A[ac].maxSerialSum))],
   ["Rows as % of printed serials", ...ACS.map((ac) => pct(A[ac].rows, A[ac].maxSerialSum, 2))],
   ["Parts short by > 2% / > 10%", ...ACS.map((ac) => A[ac].shortParts98 + " / " + A[ac].shortParts90)],
   ["EPIC in current format", ...ACS.map((ac) => pct(A[ac].epicPat.modern, A[ac].rows))],
   ["EPIC in legacy slash format", ...ACS.map((ac) => (A[ac].epicPat.slash || 0) < 100 ? n(A[ac].epicPat.slash || 0) + " rows" : pct(A[ac].epicPat.slash, A[ac].rows, 2))],
   ["EPIC in neither format", ...ACS.map((ac) => pct(nonconfEpic(A[ac]), A[ac].rows, 2))],
   ["Gender not readable", ...ACS.map((ac) => pct(unreadGender(A[ac]), A[ac].rows, 2))],
   ["Relation type blank", ...ACS.map((ac) => pct(A[ac].relation[""] || 0, A[ac].rows, 2))],
   ["Age below 18 (all)", ...ACS.map((ac) => pct(A[ac].ageLt18.total, A[ac].rows, 2))],
   ["   of which age 0 (not read)", ...ACS.map((ac) => n(A[ac].ageLt18.zero) + " rows")],
   ["   of which age 1–9", ...ACS.map((ac) => n(A[ac].ageLt18.a1_9) + " rows")],
   ["   of which age 10–17", ...ACS.map((ac) => A[ac].ageLt18.a10_17 + " rows")],
   ["Age above 120", ...ACS.map((ac) => A[ac].ageLt18.gt120 + " rows")],
   ["Name blank", ...ACS.map((ac) => n(A[ac].emptyName))],
   ["Pipeline build", "17–30 Oct 2026", "17–30 Oct 2026", "1 Nov 2026 (final)"]],
  [2.4, 1.3, 1.3, 1.3], "Table 5. Internal-consistency checks on every row of the three constituencies."));
add(P_("Two things stand out in Table 5. First, the error bounds are small everywhere: in the worst constituency fewer than two rows in a hundred fail any single check. Second, they are an order of magnitude smaller in Jewar, which was read with the final build of the pipeline, than in Noida and Dadri, which were read two weeks earlier with the builds then current: a gender that could not be read fell from about 2.5% of rows to " + pct(unreadGender(A["63"]), A["63"].rows, 2) + ", an implausible age from about 1.7% to " + pct(A["63"].ageBad, A["63"].rows, 2) + ", and an EPIC that fits no format from " + pct(nonconfEpic(A["61"]), A["61"].rows, 2) + " to " + pct(nonconfEpic(A["63"]), A["63"].rows, 2) + ". The checks, in other words, measured the improvement before the benchmark could, and they are the reason we re-read Jewar. Noida and Dadri are due the same re-read; nothing in Section 8 depends on the fields that improved."));
add(H2("6.7 External consistency"));
add(P_("Three quantities the Commission has published can be compared with what the pipeline read, without any access to its data. The state-wide sex ratio of the final roll is " + P.stateSexRatio + " women per 1,000 men; the district as read has " + D.sexRatio + " (" + ACS.map((ac) => A[ac].sexRatio + " in " + A[ac].name).join(", ") + "). The share of electors aged 18–19 is 1.32% state-wide and " + pct(D.age18_19, D.rows, 2) + " in the district as read (" + ACS.map((ac) => pct(A[ac].age18_19, A[ac].rows, 2) + " in " + A[ac].name).join(", ") + "), lower in the district, as one would expect of a destination for working-age migrants. And the press reported 4.47 lakh names, 23.98% of the district's electors, not carried into the draft, which implies a pre-revision roll of about " + lakh(gbnPreSir) + "; the " + n(D.rows) + " electors we read in the final roll are " + netDecline.toFixed(1) + "% fewer than that, against the 19.33% net reduction the same reporting gives for the final roll [3]. None of these is a test of a single field, but together they say that the district was read whole and in proportion."));
add(H2("6.8 Error analysis"));
add(P_("Across the benchmark and the consistency checks the error classes are: look-alike Devanagari glyphs in names, mostly repaired by consensus when a trusted token exists; lost punctuation in house numbers; cards whose grid cell was mislocated, which produce a blank gender or relation and are flagged; and a cover-page figure misread, which affects only the cross-check, not the rows. The failure that would most compromise an audit, a plausible-but-wrong EPIC, was not observed on the benchmark, and the format check bounds it at " + pct(nonconfEpic(A["63"]), A["63"].rows, 2) + " of rows in the final build, since a misread that still fits the format must change one of ten characters into another valid one."));

// =====================================================================
// 7 AUDIT FRAMEWORK
// =====================================================================
add(H1("7. Methodology II: an audit framework for roll revisions (RQ3)"));
add(H2("7.1 Audit questions"));
add(P_("Given the published documents of a revision, each elector row carries an Action_status (existing, added, deleted, modified) and the list it came from. The audit asks, for each booth and for the constituency: how many electors were added, deleted and modified; whether the changes are concentrated in particular booths or sections; whether the age and gender composition of the changed electors differs from that of the roll; whether the same elector appears more than once; and whether the roll's structure (age, sex ratio, household size) is what the demography of the place leads one to expect."));
add(H2("7.2 Units of analysis"));
add(P_("Constituency, part (booth), section (locality) and house number. A house number is a group of electors of one section who share a printed house number after print noise (“H.No 195”, “Hno-195”, “195”) is folded; in an urban roll it is usually a flat, in a rural roll often a compound. Electors marked deleted are excluded from structural figures, as the Commission's own counts exclude them; none are printed in the documents studied here."));
add(H2("7.3 Indicators"));
add(table(["Indicator", "Definition", "Needs", "Computed here"],
  [["Addition rate", "added / final electors", "final roll", "yes, by part and section"],
   ["Modification rate", "modified / final electors", "final roll", "yes, by part"],
   ["Deletion rate", "deleted / (existing + deleted)", "draft roll and final roll, or deletion supplement", "no"],
   ["Age and sex profile of additions", "share of additions in each age band and sex against the roll", "final roll", "yes"],
   ["Duplicate registration", "EPIC numbers that appear in more than one part", "final roll", "yes"],
   ["Sex ratio", "women per 1,000 men, by part", "final roll", "yes"],
   ["House-number sharing", "distribution of electors per house number", "final roll", "yes"],
   ["Whole-household deletion", "house numbers of two or more electors all of whom were deleted", "draft and final roll", "no"],
   ["Booth outlier score", "robust z-score of a booth's rate within the constituency (median and MAD)", "any rate", "yes, for additions"]],
  [1.5, 2.6, 1.6, 1.3], "Table 6. Audit indicators, what each needs, and which are computed in Section 8."));
add(H2("7.4 Statistical treatment"));
add(P_("Booth-level rates are reported as medians with the 10th and 90th percentiles across booths, and outliers are identified with a robust z-score (median and median absolute deviation), because the distributions are skewed and a few small booths would dominate a mean. Differences between the composition of additions and of the roll are large enough here that a test adds nothing; where they are not, chi-squared tests on banded counts are appropriate. Where booths are geocoded, spatial autocorrelation of booth rates can be measured with Moran's I; we did not do so."));
add(H2("7.5 Carrying extraction error into the audit"));
add(P_("Every rate in Section 8 is a ratio of row counts whose numerator comes from a list header (which list the card was printed in) and whose denominator is a count of cards. Neither depends on reading a name, an EPIC or an age correctly, so the completeness bounds of Table 5 are the only extraction error that reaches them: a rate computed over a part that is 2% short is at most 2% off. Indicators that do depend on a field (age bands, sex ratio, duplicates) are computed on the rows where the field was readable and the count of unreadable rows is stated beside them."));

// =====================================================================
// 8 RESULTS
// =====================================================================
add(H1("8. Results: Gautam Buddh Nagar after the revision"));
add(H2("8.1 Scale of change in the final roll"));
add(table(["", name("61"), name("62"), name("63"), "District"],
  [["Electors in the final roll (rows read)", ...ACS.map((ac) => n(A[ac].rows)), n(D.rows)],
   ["Marked “existing” (carried from the draft)", ...ACS.map((ac) => n(A[ac].action.existing)), n(sum((a) => a.action.existing))],
   ["Marked “added”", ...ACS.map((ac) => n(A[ac].action.added) + " (" + pct(A[ac].action.added, A[ac].rows) + ")"), n(D.added) + " (" + pct(D.added, D.rows) + ")"],
   ["Marked “modified”", ...ACS.map((ac) => n(A[ac].action.modified) + " (" + pct(A[ac].action.modified, A[ac].rows, 2) + ")"), n(D.modified) + " (" + pct(D.modified, D.rows, 2) + ")"],
   ["Sections with at least one addition", ...ACS.map((ac) => n(A[ac].sectionsWithAdd) + " of " + n(A[ac].sections)), n(sum((a) => a.sectionsWithAdd)) + " of " + n(sum((a) => a.sections))],
   ["Addition rate by part: median (10th–90th pct.)", ...ACS.map((ac) => (100 * A[ac].addRate.median).toFixed(1) + "% (" + (100 * A[ac].addRate.p10).toFixed(1) + "–" + (100 * A[ac].addRate.p90).toFixed(1) + "%)"), ""],
   ["Women among additions", ...ACS.map((ac) => n(A[ac].addedGender.F) + " of " + n(A[ac].addedGender.F + A[ac].addedGender.M) + " (" + pct(A[ac].addedGender.F, A[ac].addedGender.F + A[ac].addedGender.M) + ")"), pct(sum((a) => a.addedGender.F), sum((a) => a.addedGender.F + a.addedGender.M))],
   ["Additions aged 18–29", ...ACS.map((ac) => pct(A[ac].added18_29, A[ac].action.added)), pct(sum((a) => a.added18_29), D.added)],
   ["Median age of additions / of the roll", ...ACS.map((ac) => A[ac].addedMedianAge + " / " + A[ac].medianAge.all), ""]],
  [2.3, 1.3, 1.3, 1.3, 1.3], "Table 7. What the final roll records about the revision. Women among additions are counted over rows with a readable gender."));
add(P_("Between a twentieth and a thirteenth of the final roll is new: " + n(D.added) + " electors, " + pct(D.added, D.rows) + " of the district, were added between the draft of 6 January and the final roll of 10 April 2026, and " + n(D.modified) + " entries (" + pct(D.modified, D.rows, 2) + ") were modified. Dadri added the most, in number and in share; Noida the least. The additions are not concentrated: " + pct(sum((a) => a.sectionsWithAdd), sum((a) => a.sections), 0) + " of the " + n(sum((a) => a.sections)) + " sections in the district gained at least one elector, and in every constituency the middle 80% of booths gained between about 1% and 14% of their electors (Table 7)."));
add(H2("8.2 Who was added"));
add(figure("fig9_age_pyramids.png", "Figure 9. Age–sex structure of the district's final roll (left) and of the electors marked as added in it (right), as read by the pipeline; rows without a readable age and gender are excluded.", 6.6));
add(P_("Figure 9 answers the question the revision debate most often asked about additions. The roll as a whole has the shape of a working-age city: its median age is " + A["61"].medianAge.all + " in Noida and " + A["63"].medianAge.all + " in Jewar, with the largest bands at 30–49. The additions are young: their median age is " + A["61"].addedMedianAge + " in Noida, " + A["62"].addedMedianAge + " in Dadri and " + A["63"].addedMedianAge + " in Jewar, and " + pct(A["63"].added18_29, A["63"].action.added, 0) + " of Jewar's additions are aged 18–29 against " + pct(A["61"].added18_29, A["61"].action.added, 0) + " of Noida's. The rural constituency's additions, in other words, are overwhelmingly first-time electors coming of age; the urban constituency's are spread across working ages, which is what one expects where people move in. Women are " + pct(A["61"].addedGender.F, A["61"].addedGender.F + A["61"].addedGender.M) + " of Noida's additions and " + pct(A["62"].addedGender.F, A["62"].addedGender.F + A["62"].addedGender.M) + " of Dadri's, a higher share than their " + pct(A["61"].gender.F, A["61"].gender.F + A["61"].gender.M) + " and " + pct(A["62"].gender.F, A["62"].gender.F + A["62"].gender.M) + " of the roll; in Jewar they are " + pct(A["63"].addedGender.F, A["63"].addedGender.F + A["63"].addedGender.M) + " of additions against " + pct(A["63"].gender.F, A["63"].gender.F + A["63"].gender.M) + " of the roll. Marriage migration into the urban constituencies is the likeliest reason, and it is one the draft roll could confirm."));
add(H2("8.3 Variation across booths"));
add(figure("fig11_booth_distributions.png", "Figure 10. Booth-level distributions. Left: electors added as a share of the part. Right: women per 1,000 men in the part, for parts with more than 50 men.", 7.0));
add(P_("Figure 10 shows how the booths differ. Addition rates have a long right tail in every constituency. The most extreme are part 163 of Jewar, where " + n(334) + " of 545 electors (61%) are new, part 786 of Dadri, a booth of only 54 electors of whom 27 are new, and parts 522, 803 and 535 of Noida, each with 23–24% new electors. A high addition rate is not in itself a fault: a new housing society or a booth created by splitting an old one looks exactly like this, and the Commission's section list for the part would say which. What the audit provides is the list of booths that merit the question. Sex ratios tell the three places apart. In Jewar nearly every part lies between 650 and 1,000 women per 1,000 men (booth median " + boothMedianSR("63") + "); in Noida they run from below 500 to above 1,200 (median " + boothMedianSR("61") + "), with Dadri in between (median " + boothMedianSR("62") + "). The station names say why. Noida has " + boothSR("61").filter((v) => v > 1000).length + " parts above 1,000 and " + boothSR("61").filter((v) => v < 700).length + " below 700; at the top of its distribution are the clubhouses of gated housing societies in Sectors 78 and 93, at the bottom the urban villages of Jhundpura, Atta and Sorkha, where men who have come for work outnumber women. Dadri's highest ratios belong to society clubhouses in Gaur City and Sector 137 and to a university campus; Jewar has no part above 1,031. A booth's sex ratio is a description of who lives there, and only a change from the part's own earlier roll would mark it for scrutiny."));
add(H2("8.4 Electors who appear twice"));
add(table(["", name("61"), name("62"), name("63")],
  [["EPIC numbers (current format) found in two parts", ...ACS.map((ac) => n(A[ac].dupEpics))],
   ["… as a share of electors", ...ACS.map((ac) => pct(A[ac].dupEpics, A[ac].rows, 2))],
   ["… with the same printed age in both parts", ...ACS.map((ac) => n(A[ac].dupSameAge) + " (" + pct(A[ac].dupSameAge, A[ac].dupEpics, 0) + ")")],
   ["… with the same name read in both parts", ...ACS.map((ac) => n((A[ac].dups.sameName_sameAge || 0) + (A[ac].dups.sameName_diffAge || 0)))]],
  [2.6, 1.3, 1.3, 1.3], "Table 8. EPIC numbers that occur in more than one part of the same constituency in the final roll."));
add(P_("An EPIC number is meant to identify one elector. In the final roll as read, " + n(A["61"].dupEpics) + " EPIC numbers occur in two different parts of Noida, " + n(A["62"].dupEpics) + " in Dadri and " + n(A["63"].dupEpics) + " in Jewar. These are candidates, not findings: an OCR error that turns one digit of a real EPIC into another could produce a collision. But a collision between two unrelated electors would match their printed ages only by chance, about once in fifty, and in fact the two cards carry the same age in " + pct(A["63"].dupSameAge, A["63"].dupEpics, 0) + " to " + pct(A["61"].dupSameAge, A["61"].dupEpics, 0) + " of cases. Most of these pairs are therefore the same person on two booths' rolls, in most cases with the name read slightly differently on the two cards. Removing multiple enrolments was one of the stated purposes of the revision, and the Commission reported 1.65% of the state's electors in that category at the draft stage; at " + pct(A["63"].dupEpics, A["63"].rows, 2) + " to " + pct(A["62"].dupEpics, A["62"].rows, 2) + " of electors, what remains within a single constituency after the revision is small, and it is concentrated in the two urban constituencies, where a move from one sector to another is the usual cause. Duplicates across constituencies and across districts, which the same method would find, were not computed."));
add(H2("8.5 The structure of the roll"));
add(figure("fig10_age_heaping.png", "Figure 11. Electors by single year of age, three constituencies together. The heaps lie at ages ending in 1 and the troughs at ages ending in 0: round ages reported at an earlier enumeration, advanced by one year to the revision's qualifying date.", 7.0));
add(P_("Figure 11 is a check as much as a result, and it did not show what we expected. Self-reported ages in India heap on multiples of five and ten, and that is what we looked for. Instead the heaps sit one year above the round numbers. In Jewar there are " + n(A["63"].ageHist["60"]) + " electors aged 60 and " + n(A["63"].ageHist["61"]) + " aged 61, " + n(A["63"].ageHist["70"]) + " aged 70 and " + n(A["63"].ageHist["71"]) + " aged 71, and the same step appears at 41, 51, 56, 66 and 76. The likeliest explanation is that the ages were reported in round numbers at an earlier enumeration and have since been advanced by one year to the qualifying date of the revision, 1 January 2026, as the Commission's rolls do at each revision. The pattern is sharpest in rural Jewar, where ages are reported from memory, and faint in Noida, where they come from documents. A pipeline that misread digits at random would blur a pattern this sharp; its survival, with an intelligible cause, is evidence that the age field is read faithfully. It is also a caution for anyone computing age bands from the roll: a boundary at a round age splits a heap from its trough, and our bands (20–29, 30–39 and so on) keep each heap and its trough on the same side."));
add(figure("fig12_household_size.png", "Figure 12. Electors sharing one printed house number within a section, as a share of all house numbers in the constituency.", 5.2));
add(P_("Figure 12 shows the urban–rural gradient in the sharpest form the roll offers. In Noida " + pct(A["61"].hhSize["1"], A["61"].households, 0) + " of house numbers carry a single elector and " + pct(A["61"].hhSize["10+"], A["61"].households) + " carry ten or more; in Jewar " + pct(A["63"].hhSize["1"], A["63"].households, 0) + " carry one and " + pct(A["63"].hhSize["10+"], A["63"].households) + " carry ten or more, the largest a single number with " + n(A["63"].hhMax) + " electors. The Noida figure reflects flats and the roll's habit of recording tenants under their own numbers; the Jewar figure reflects joint households and the use of one number for a compound. The same gradient appears in how women are registered: in Jewar " + pct(A["63"].relByGender["F|Father"], A["63"].relByGender["F|Father"] + A["63"].relByGender["F|Husband"]) + " of women are listed under their father's name rather than a husband's, in Dadri " + pct(A["62"].relByGender["F|Father"], A["62"].relByGender["F|Father"] + A["62"].relByGender["F|Husband"]) + ", in Noida " + pct(A["61"].relByGender["F|Father"], A["61"].relByGender["F|Father"] + A["61"].relByGender["F|Husband"]) + ". Any household-level indicator, including the whole-household deletion rate the framework defines, has to be read with this in mind: a rural “house number” of 40 electors is a hamlet, and a deletion of all of them means something different from the deletion of a family of four."));
add(P_("One question the roll can answer directly is whether it carries anyone too young to be on it. It does not, so far as the printed age can tell. Of " + n(D.rows) + " electors in the district, " + n(sum((a) => a.ageLt18.total)) + " are printed with an age below 18, and Section 6.6 shows that all but " + n(sum((a) => a.ageLt18.a10_17)) + " of those are an age the pipeline could not read (0) or a single surviving digit of a two-digit age. The " + n(sum((a) => a.ageLt18.a10_17)) + " rows printed with an age between 10 and 17, " + sum((a) => a.ageLt18.a17) + " of them at 17, are identifiable by part and serial in the released data for anyone who wishes to check them against the PDF; at " + pct(sum((a) => a.ageLt18.a10_17), D.rows, 3) + " of the roll they are within the misread rate of the age field itself, and the final build produced " + A["63"].ageLt18.a10_17 + " such row in Jewar. Whatever else the revision did, it did not leave minors on the final roll of this district in any number the roll itself reveals."));
add(H2("8.6 What the final roll cannot show: deletions"));
add(P_("The revision's most contested quantity is the number of electors removed, and the final roll does not contain it. A deleted elector is simply not printed. What the final roll gives is the number of electors who survived the revision and the number added after the draft; the number removed can only be obtained by subtracting the final roll from the roll it replaced, or from the draft, both of which are published in the same image-only form and neither of which we collected. The press figures for the district, derived from Commission data, are a net loss of 4.47 lakh electors (23.98%) at the draft stage and of 19.33% at the final roll [2, 3]. Our count of " + n(D.rows) + " electors in the final roll is " + netDecline.toFixed(1) + "% below the pre-revision roll those figures imply, which is consistent with them, but it is a consistency check and not a measurement. A measurement requires the draft roll, and with it the pipeline would deliver the deletion indicators of Table 6 at booth level, including the age and sex profile of the deleted and the house numbers emptied entirely. That is the natural next run."));
add(H2("8.7 Robustness"));
add(P_("The addition and modification counts in Table 7 come from list headers and card counts and are unaffected by the field-level error rates of Table 5; the completeness bound means that any part's addition rate is at most as far off as that part is short, which for all but " + (A["61"].shortParts90 + A["62"].shortParts90 + A["63"].shortParts90) + " parts in the district is under 10% and for the great majority under 2%. The age and sex figures of Section 8.2 exclude rows without a readable age or gender; in Jewar those are " + pct(unreadGender(A["63"]), A["63"].rows, 2) + " of rows, in Noida and Dadri about 2.5%, and there is no reason to expect them to be young or female in a way that would move the shares reported. The duplicate counts of Section 8.4 are computed on EPICs in the current format only and are, if anything, undercounts, since a misread EPIC cannot match its twin."));

// =====================================================================
// 9 DISCUSSION
// =====================================================================
add(H1("9. Discussion"));
add(H2("9.1 What the evaluation shows"));
add(P_("On a roll for which a template and a hand-checked page exist, the local engine reads identity fields (EPIC, age, gender, relation) without error on the benchmark page and names with one error in thirty, flags most of what it gets wrong, reads a complete district to within 1% of the printed serial numbers, and reproduces the Commission's published sex ratio. That is sufficient for booth-level aggregate audit, where a one-in-thirty name error does not change an addition rate, provided the bounds of Section 7.5 are carried through. It is not sufficient for individual-level claims about a named elector, and we make none."));
add(H2("9.2 Implications for election administration"));
add(P_("The principal implication is that image-only publication does not prevent structured extraction; it raises the cost of extraction to a level that favours well-resourced actors over citizens and researchers. A rented server reads a constituency overnight. If the Commission's concern is bulk harvesting of personal data, rasterisation does not address it; if its concern is public scrutiny of revisions, rasterisation serves it only through obscurity. The second implication is specific to the revision: the final roll alone, however completely read, cannot answer the question that mattered most in public debate. The documents that could, the draft and the deletion lists, are published in the same form."));
add(H2("9.3 Implications for low-resource document AI"));
add(P_("Three design choices generalise beyond electoral rolls. Field-specific recognition passes (whitelists, scale, script model) beat a single generic pass by a wide margin on structured forms. Single-edit consensus against trusted tokens repairs the dominant Devanagari error classes without a language model. And a flag taxonomy with a tunable threshold, combined with consistency checks that the whole corpus must pass, turns an OCR system into an instrument whose uncertainty is reported and whose improvement between builds can be measured without new ground truth, which is what Section 6.6 did."));
add(H2("9.4 Is image-only publication a privacy safeguard?"));
add(P_("No, and it is arguably the worst of both worlds: it does not stop extraction by motivated parties, while it makes the privacy-preserving alternative, official publication of booth-level aggregate statistics on additions and deletions by age band and sex, with no names, look unnecessary. Every number in Section 8 could be published by the Commission from data it already holds, at no risk to any elector, and would then not need to be reconstructed from images."));
add(H2("9.5 Recommendations"));
add(bullet("For the Commission: publish, with each draft and final roll, a booth-level table of elector counts and of additions, deletions and modifications by age band and sex, and a machine-readable part list, which it already serves to its own portal."));
add(bullet("For researchers and civil society: use validated, open extraction with reported error rates and consistency checks; publish aggregates only; fix the audit indicators before the documents are read."));
add(bullet("For tool builders: ship uncertainty flags and a benchmark page for every print template, and treat a rise in the consistency-check failure rate as a signal to stop and fix the template rather than noise to filter."));
add(H2("9.6 Generalisability"));
add(P_("The layout engine is template-driven and the Uttar Pradesh template was used unchanged on all three constituencies; the same template has since been applied to other Hindi-belt districts, and a Madhya Pradesh roll was read with the default template with only the section header unrecognised. Adding a state means adding a template and a benchmark page. The transliteration engine is Hindi-specific; Marathi, Telugu and Kannada rolls need their own rules and seed corpora."));

// =====================================================================
// 10 ETHICS
// =====================================================================
add(H1("10. Ethical considerations"));
add(H2("10.1 Personal data and the DPDP Act"));
add(P_("Electoral rolls contain personal data of every adult. Processing it for research is lawful under the Digital Personal Data Protection Act, 2023 only for a specified purpose and with minimisation; the public-availability exemption does not apply because the electors did not make the data public themselves. All processing in this study is for the purpose of aggregate audit of the revision process."));
add(H2("10.2 Data minimisation and release"));
add(P_("No row-level data, no names and no EPIC numbers are published with this paper. Every figure and table is an aggregate at booth level or above; the smallest group reported anywhere is a booth of 54 electors. The code and the booth-level aggregates behind the figures are released; the extracted rows are not. The benchmark page is distributed pixelated; the ground-truth file that accompanies the code transcribes 30 real cards from a public document, and we will replace it with a synthetic page if the venue asks."));
add(H2("10.3 No inference of sensitive attributes"));
add(P_("The transliteration layer would make it technically possible to infer religion or caste from names. We do not do so, the released code contains no such function, and we consider any audit that does so to have left the domain of election integrity for that of profiling."));
add(H2("10.4 Dual use"));
add(P_("The same pipeline that enables an audit enables campaign targeting. The mitigations are that the paper publishes method and aggregates, not data; that the indicators were fixed before the district was read; that the code is released for audit and research use; and that the recommendation of Section 9.5 would, if adopted, make the extraction unnecessary."));
add(H2("10.5 Ethics review"));
add(P_("The study was not submitted to an institutional ethics committee; the author's employer has none, and no participant was recruited. The study uses only documents the Commission publishes and reports only aggregates. We would welcome review by a venue's ethics process."));
add(H2("10.6 Conflict of interest"));
add(P_("This study was carried out as independent research. It used only documents the Election Commission publishes; no commercial, customer or proprietary data was used, and no organisation had a role in its design, analysis or conclusions."));

// =====================================================================
// 11 LIMITATIONS
// =====================================================================
add(H1("11. Limitations"));
add(bullet([b("Benchmark size. "), run("Field-level accuracy rests on one page of 30 cards and transliteration on 113 names from one district. The consistency checks of Section 6.6 bound the error on every row but do not replace a larger benchmark with a second annotator.")]));
add(bullet([b("Two builds. "), run("Noida and Dadri were read with October builds of the pipeline and Jewar with the final build; Table 5 quantifies the difference. The indicators reported for Noida and Dadri do not depend on the fields that improved, but their structural figures carry about 2.5% unreadable rows against 0.3% in Jewar.")]));
add(bullet([b("No draft roll. "), run("Deletions, the quantity the revision debate turned on, cannot be measured from the final roll and were not measured. The comparison with press figures in Section 8.6 is a consistency check against numbers derived from reporting, not an audit.")]));
add(bullet([b("Duplicates are candidates. "), run("Two cards with one EPIC and one age are very probably one elector, but only the Commission's records could confirm it.")]));
add(bullet([b("House numbers. "), run("A printed house number is a flat in Noida and a compound in Jewar; household indicators built on it are indicative.")]));
add(bullet([b("One district. "), run("Gautam Buddh Nagar is among the most urban districts in Uttar Pradesh. Its addition rates, sex ratios and duplicate rates say nothing about the state's others.")]));

// =====================================================================
// 12 CONCLUSION
// =====================================================================
add(H1("12. Conclusion and future work"));
add(P_("India's electoral rolls are published in a form that is open in law and closed in practice. We have shown that a pipeline running on a rented CPU server, with no paid model, reads a complete district of " + n(D.rows) + " electors from " + n(C.pages) + " scanned pages to within 1% of the printed serial numbers, reports its own uncertainty, and reproduces the Commission's published demographic figures. The answer to RQ1 is yes, within the limits of the benchmark and with the consistency checks as the guarantee at scale; to RQ2, that field-specific passes and consensus remove most single-pass error and that the flags and checks catch most of what remains. On RQ3 the final roll says that " + pct(D.added, D.rows) + " of the district's electors were added after the draft, spread across nearly every section, young and, in the urban constituencies, more often women than men; that a few booths gained a quarter or more of their electors; that a small number of electors still appear twice; and that the revision's deletions can be measured only from the draft. Future work is the draft roll of the same district, which would complete the audit; the re-read of Noida and Dadri with the final build; a larger benchmark with a second annotator; and templates and transliteration for the scripts of other states."));

// =====================================================================
// BACK MATTER
// =====================================================================
add(H1("Acknowledgements"));
add(P_("The rolls were published by the Election Commission of India and its Chief Electoral Officer, Uttar Pradesh. The pipeline builds on Tesseract and Poppler."));
add(H1("Author contributions"));
add(P_("Syed Md Furquan: conceptualisation, software, data curation, methodology, validation, analysis, visualisation, writing."));
add(H1("Funding"));
add(P_("This research received no external funding."));
add(H1("Data and code availability"));
add(P_("The pipeline (downloader, OCR, consensus and transliteration engine), the benchmark page in pixelated form, the held-out transliteration set, the booth-level aggregates behind every figure and table (data/gbn_stats.json) and the scripts that produce them are maintained at https://github.com/Furquan712/Brahmastra_OCR_Eroll, with access on request until publication. Extracted rows are not released (Section 10.2). The source PDFs are public on the ECI CDN at the URL patterns given in Section 4.1, and the official part lists at the portal endpoint named there."));

add(H1("References"));
const refs = [
  "Prasar Bharati News Services. Uttar Pradesh electorate grows by over 84 lakh after completion of SIR exercise. News On AIR, 10 April 2026. https://www.newsonair.gov.in/uttar-pradesh-electorate-grows-by-over-84-lakh-after-completion-of-sir-exercise",
  "ThePrint. 2.89 crore names struck off electoral roll in UP draft SIR; highest deletions in Lucknow, Ghaziabad. 6 January 2026. https://theprint.in/india/2-89-crore-names-off-the-electoral-rolls-in-up-draft-sir-highest-deletions-in-lucknow-ghaziabad/2820272/",
  "A. Mandhani. Bengaluru to Lucknow, why urban centres are seeing high electoral roll deletions during SIR. ThePrint, 28 August 2026. https://theprint.in/india/governance/bengaluru-to-lucknow-why-urban-centres-are-seeing-high-electoral-roll-deletions-during-sir/3026124/",
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
  "District Administration, Gautam Buddh Nagar. Special Intensive Revision (SIR) 2026: lists of voters with no mapping and logical discrepancy, 61-Noida, 62-Dadri, 63-Jewar. https://gbnagar.nic.in/list-of-voters-with-no-mapping-and-logical-discrepancy/ (updated 16 February 2026).",
];
refs.forEach((r, i) => body.push(new Paragraph({ spacing: { after: 80 }, indent: { left: 400, hanging: 400 }, children: [run(`[${i + 1}] ${r}`, { size: 20 })] })));

// =====================================================================
// APPENDICES
// =====================================================================
add(new Paragraph({ children: [new PageBreak()] }));
add(H1("Appendix A. Roll page and cover layout"));
add(figure("fig1b_cover_redacted.png", "Figure A1. Cover page of a part PDF (pixelated). The top block identifies state, constituency and part; the middle block lists the administrative units; the bottom block gives polling-station details, the elector count and the last serial number.", 3.4));
add(H1("Appendix B. Annotation guidelines for the benchmark"));
add(P_("Render the page at 300 dpi. Transcribe every field exactly as printed, including leading zeros, punctuation in house numbers and the roll's own spelling of a name even if it is inconsistent with the same name elsewhere. Serial is the grid position. Record the relation type as printed (पिता/माता/पति) and gender as printed. Do not consult the OCR output while annotating. A second annotator repeats the page; disagreements are resolved by a third reading of the image."));
add(H1("Appendix C. Flag taxonomy"));
add(table(["Flag", "Meaning", "Rows in the Jewar run"],
  [["low_confidence", "card confidence below the threshold (default 0.70)", n(J.flagCounts.low_confidence)],
   ["epic_low_conf / name_low_conf / relation_name_low_conf / age_gender_low_conf", "the field's vote was not unanimous or its confidence was low", `${n(J.flagCounts.epic_low_conf)} / ${n(J.flagCounts.name_low_conf)} / ${n(J.flagCounts.relation_name_low_conf)} / ${n(J.flagCounts.age_gender_low_conf)}`],
   ["epic_invalid", "EPIC does not match either ECI format", n(J.flagCounts.epic_invalid)],
   ["epic_autocorrected", "majority vote changed the plurality EPIC read", n(J.flagCounts.epic_autocorrected)],
   ["epic_unreadable / name_unreadable / age_unreadable / gender_unreadable / relation_unreadable", "no usable read for the field", `${n(J.flagCounts.epic_unreadable)} / ${n(J.flagCounts.name_unreadable)} / ${n(J.flagCounts.age_unreadable)} / ${n(J.flagCounts.gender_unreadable)} / ${n(J.flagCounts.relation_unreadable)}`],
   ["name_missing / age_missing", "field not found in the card", `${n(J.flagCounts.name_missing)} / ${n(J.flagCounts.age_missing)}`],
   ["name_hi_corrected / relation_name_hi_corrected", "consensus repaired a one-edit defect towards a trusted token (original kept in the log)", `${n(J.flagCounts.name_hi_corrected)} / ${n(J.flagCounts.relation_name_hi_corrected)}`],
   ["serial_corrected", "serial read disagreed with grid order; grid order used", n(J.flagCounts.serial_corrected)],
   ["serial_gap", "a serial is missing from the sequence on the page", n(J.flagCounts.serial_gap)],
   ["age_under_18 / age_out_of_range", "age read is impossible for an elector", n(J.flagCounts.age_under_18)],
   ["dup_epic_replaced_earlier", "a later row with the same EPIC replaced this one in the merged CSV", n(J.flagCounts.dup_epic_replaced_earlier)]],
  [2.4, 3.2, 1.4], "Table C1. Flags written to the _flag_reason column, with their counts on the " + n(J.rows) + " rows of the Jewar run."));
add(H1("Appendix D. Transliteration rules and examples"));
add(P_("Schwa deletion: सुरेश → Suresh, कमला → Kamla, रामचंद्र → Ramchandra. Aspirates: छ → chh, ख → kh, श/ष → sh. Long vowels without diacritics: ी → i or ee by learned context; ू → u or oo. Nasals: anusvara before a stop takes the homorganic nasal (चंद्र → Chandra). Overrides: exact tokens whose conventional spelling is not derivable (सिंह → Singh, खान → Khan)."));
add(H1("Appendix E. Per-constituency tables"));
add(table(["", name("61"), name("62"), name("63")],
  [["Parts", ...ACS.map((ac) => n(A[ac].parts))],
   ["Pages", ...ACS.map((ac) => n(A[ac].pages))],
   ["Electors (rows read)", ...ACS.map((ac) => n(A[ac].rows))],
   ["Electors per part: min / median / max", ...ACS.map((ac) => `${A[ac].partSize.min} / ${A[ac].partSize.median} / ${n(A[ac].partSize.max)}`)],
   ["Parts under 300 electors", ...ACS.map((ac) => A[ac].partSize.lt300)],
   ["Men / women (readable gender)", ...ACS.map((ac) => `${n(A[ac].gender.M)} / ${n(A[ac].gender.F)}`)],
   ["Women per 1,000 men", ...ACS.map((ac) => A[ac].sexRatio)],
   ["Median age: men / women", ...ACS.map((ac) => `${A[ac].medianAge.M} / ${A[ac].medianAge.F}`)],
   ["Aged 18–19", ...ACS.map((ac) => `${n(A[ac].age18_19)} (${pct(A[ac].age18_19, A[ac].rows, 2)})`)],
   ["Aged 80 and over", ...ACS.map((ac) => `${n(A[ac].age80plus)} (${pct(A[ac].age80plus, A[ac].rows, 2)})`)],
   ["Relation: father / husband / mother", ...ACS.map((ac) => `${n(A[ac].relation.Father)} / ${n(A[ac].relation.Husband)} / ${n(A[ac].relation.Mother)}`)],
   ["Women listed under father rather than husband", ...ACS.map((ac) => pct(A[ac].relByGender["F|Father"], A[ac].relByGender["F|Father"] + A[ac].relByGender["F|Husband"]))],
   ["Distinct house numbers (within section)", ...ACS.map((ac) => n(A[ac].households))],
   ["House numbers with one elector", ...ACS.map((ac) => pct(A[ac].hhSize["1"], A[ac].households))],
   ["House numbers with ten or more", ...ACS.map((ac) => pct(A[ac].hhSize["10+"], A[ac].households))],
   ["Largest house number (electors)", ...ACS.map((ac) => n(A[ac].hhMax))],
   ["Sections", ...ACS.map((ac) => n(A[ac].sections))],
   ["Added / modified", ...ACS.map((ac) => `${n(A[ac].action.added)} / ${n(A[ac].action.modified)}`)],
   ["Addition rate by part: min / median / max", ...ACS.map((ac) => `${(100 * A[ac].addRate.min).toFixed(1)}% / ${(100 * A[ac].addRate.median).toFixed(1)}% / ${(100 * A[ac].addRate.max).toFixed(1)}%`)]],
  [2.4, 1.3, 1.3, 1.3], "Table E1. Summary statistics of the three constituencies as read."));
add(H1("Appendix F. Software versions and hardware"));
add(P_("Pipeline commit 4926c11 (30 October 2026); TypeScript on Node.js ≥ 20, with sharp 0.35 (libvips) for image operations and zod for schema validation; no GPU, no model API. Server: Ubuntu 26.04, 8 vCPU AMD EPYC Genoa (one thread per core), 16 GB RAM, no swap, Node.js 22.22, Tesseract 5.5.0 (Leptonica 1.86) with the hin and eng models, Poppler 26.01. Desktop: macOS 26.6, Apple M4 (10 cores), 16 GB, Node.js 22.17, Tesseract 5.5.3, Poppler 26.09. Rendering at 300 dpi; each Tesseract process limited to one thread; four pages in flight per process on the server, two processes sharing the machine; the scaling measurements of Table 4b were made on the otherwise idle desktop."));
add(H1("Appendix G. Reproducibility"));
add(bullet("Benchmark page and ocr-eval: npm run build && node dist/cli.js ocr-eval"));
add(bullet("Transliteration scores: node dist/cli.js translit-eval, with --rules-only and --no-lexicon"));
add(bullet("Official part lists: python3 eci_parts.py --state S24 --district \"Gautam Buddh Nagar\" --ac 61 62 63"));
add(bullet("Constituency run: node dist/cli.js run \"raw-data/Uttar Pradesh/63-Jewar-2026-Final\" (summary in output/<State>/<AC>/*.summary.json)"));
add(bullet("Booth-level aggregates and figures: paper/data/gbn_stats.json; python3 paper/make_figs.py; node paper/build_paper.cjs"));

// =====================================================================
// DOCUMENT
// =====================================================================
const doc = new Document({
  creator: "Syed Md Furquan",
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
Packer.toBuffer(doc).then((b) => { fs.writeFileSync(__dirname + "/Making_the_Invisible_Roll_Visible.docx", b); console.log("written", b.length); });
