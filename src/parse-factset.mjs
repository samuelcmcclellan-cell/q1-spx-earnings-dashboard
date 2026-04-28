// parse-factset.mjs — extract structured data from a FactSet Earnings Insight PDF
//
// Strategy:
//   1. Read PDF via pdf-parse, get per-page text.
//   2. Concatenate all pages (with page tags) into one searchable corpus.
//   3. Run regex extractors against either single-page text or the full corpus.
//   4. Every extractor returns null on miss — never throws — so a wording
//      change in one section doesn't break the whole report.
//
// Each extractor records the page it sourced from in `_provenance` so the
// Excel "Raw Data" sheet can cite the page number for every figure.

import { readFileSync } from 'fs';
import { basename } from 'path';
import { createRequire } from 'module';
import { extractSectorCharts } from './extract-charts.mjs';
const require = createRequire(import.meta.url);
const { PDFParse } = require('pdf-parse');

const SECTORS = [
  'Communication Services',
  'Consumer Discretionary',
  'Consumer Staples',
  'Energy',
  'Financials',
  'Health Care',
  'Industrials',
  'Information Technology',
  'Materials',
  'Real Estate',
  'Utilities',
];

// ---- helpers --------------------------------------------------------------

const num = (s) => {
  if (s === undefined || s === null) return null;
  const cleaned = String(s).replace(/,/g, '').replace(/[%$x]/g, '').trim();
  const v = parseFloat(cleaned);
  return Number.isFinite(v) ? v : null;
};

// Find first regex match in `text` and return capture group `idx` as a number.
const matchNum = (text, re, idx = 1) => {
  const m = text.match(re);
  return m ? num(m[idx]) : null;
};

// Find regex match across pages; return { value, page } or null.
const findInPages = (pages, re, idx = 1) => {
  for (const p of pages) {
    const m = p.text.match(re);
    if (m) return { value: num(m[idx]), page: p.num };
  }
  return null;
};

// Extract a section of text bounded by a starting heading and the next heading.
const sliceSection = (text, startRe, endRes = []) => {
  const start = text.search(startRe);
  if (start < 0) return null;
  const tail = text.slice(start);
  let end = tail.length;
  for (const er of endRes) {
    const i = tail.search(er);
    if (i > 0 && i < end) end = i;
  }
  return tail.slice(0, end);
};

// Find every full sentence in `text` whose body contains `triggerRe`.
// A "sentence" is delimited by periods. Used to capture sector callouts
// like "the Energy (100%), Health Care (100%), ... sectors have the highest
// percentages..." where the sector list appears BEFORE the trigger phrase.
const findSentencesContaining = (text, triggerRe) => {
  const flags = triggerRe.flags.includes('g') ? triggerRe.flags : triggerRe.flags + 'g';
  const re = new RegExp(triggerRe.source, flags);
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    let start = m.index;
    while (start > 0 && text[start - 1] !== '.') start--;
    let end = m.index + m[0].length;
    while (end < text.length && text[end] !== '.') end++;
    out.push(text.slice(start, end + 1));
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
};

// ---- extractors -----------------------------------------------------------

function extractMeta(pages, sourcePath) {
  const p1 = pages[0]?.text ?? '';
  const dateMatch = p1.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/,
  );
  const quarterMatch = p1.match(/\b(Q[1-4])\s+(\d{4})\b/);
  return {
    asOfDate: dateMatch ? dateMatch[0] : null,
    quarter: quarterMatch ? `${quarterMatch[1]} ${quarterMatch[2]}` : null,
    sourcePdf: basename(sourcePath),
    parsedAt: new Date().toISOString(),
    pageCount: pages.length,
  };
}

function extractKeyMetrics(pages) {
  const all = pages.map((p) => p.text).join('\n');

  // % reported, % beat EPS, % beat revenue
  const reported = matchNum(all, /with\s+(\d+)%\s+of\s+S&P\s*500\s+companies\s+reporting\s+actual\s+results/i);
  const beatEps = matchNum(
    all,
    /(\d+)%\s+of\s+S&P\s*500\s+companies\s+(?:have|has)\s+reported\s+a\s+positive\s+EPS\s+surprise/i,
  );
  const beatRev = matchNum(
    all,
    /(\d+)%\s+of\s+S&P\s*500\s+companies\s+(?:have|has)\s+reported\s+a\s+positive\s+revenue\s+surprise/i,
  );

  // blended growth rates
  const blendedEarn = matchNum(
    all,
    /blended\s*\(year-over-year\)\s+earnings\s+growth\s+rate\s+for\s+the\s+S&P\s*500\s+is\s+(-?\d+(?:\.\d+)?)/i,
  );
  const blendedRev = matchNum(
    all,
    /blended\s*\(year-over-year\)\s+revenue\s+growth\s+rate\s+for\s+(?:the\s+S&P\s*500\s+|Q\d\s+\d{4}\s+)?(?:is\s+)?(-?\d+(?:\.\d+)?)/i,
  );

  // guidance counts (current quarter forward)
  const negGuid = matchNum(all, /(\d+)\s+S&P\s*500\s+companies\s+have\s+issued\s+negative\s+EPS\s+guidance/i);
  const posGuid = matchNum(all, /(\d+)\s+S&P\s*500\s+companies\s+have\s+issued\s+positive\s+EPS\s+guidance/i);

  // Forward 12M P/E
  const fwdPe = matchNum(all, /forward\s+12-?month\s+P\/E\s+ratio\s+for\s+the\s+S&P\s*500\s+is\s+(\d+(?:\.\d+)?)/i);
  const fwdPe5yr = matchNum(
    all,
    /forward\s+12-?month\s+P\/E\s+ratio[\s\S]{0,200}?5-year\s+average\s+\((\d+(?:\.\d+)?)\)/i,
  );
  const fwdPe10yr = matchNum(
    all,
    /forward\s+12-?month\s+P\/E\s+ratio[\s\S]{0,200}?10-year\s+average\s+\((\d+(?:\.\d+)?)\)/i,
  );

  return {
    pctReported: reported,
    pctBeatEps: beatEps,
    pctBeatRevenue: beatRev,
    blendedEarningsGrowth: blendedEarn,
    blendedRevenueGrowth: blendedRev,
    negativeGuidanceCount: negGuid,
    positiveGuidanceCount: posGuid,
    fwdPe,
    fwdPe5yr,
    fwdPe10yr,
  };
}

function extractScorecard(pages) {
  const all = pages.map((p) => p.text).join('\n');

  // EPS beat: current already in keyMetrics; pull the historical averages from the scorecard section.
  // Pattern: "above the 1-year average (79%), above the 5-year average (78%), and above the 10-year average (76%)"
  const epsBeatHistRe =
    /reporting\s+EPS\s+above\s+the\s+mean\s+EPS\s+estimate[\s\S]*?1-year\s+average\s+\((\d+)%\)[\s\S]*?5-year\s+average\s+\((\d+)%\)[\s\S]*?10-year\s+average\s+\((\d+)%\)/i;
  const epsBeatHist = all.match(epsBeatHistRe);

  // EPS surprise: "12.3% above expectations. ... 1-year average (+7.2%), ... 5-year average (+7.3%), ... 10-year average (+7.1%)"
  const epsSurpRe =
    /companies\s+are\s+reporting\s+earnings\s+that\s+are\s+(-?\d+(?:\.\d+)?)%\s+above\s+expectations[\s\S]*?1-year\s+average\s+\(([+\-]?\d+(?:\.\d+)?)%\)[\s\S]*?5-year\s+average\s+\(([+\-]?\d+(?:\.\d+)?)%\)[\s\S]*?10-year\s+average\s+\(([+\-]?\d+(?:\.\d+)?)%\)/i;
  const epsSurp = all.match(epsSurpRe);

  // Revenue beat:
  const revBeatRe =
    /(\d+)%\s+of\s+the\s+companies\s+have\s+reported\s+actual\s+revenues\s+above\s+estimated\s+revenues[\s\S]*?1-year\s+average\s+\((\d+)%\)[\s\S]*?5-year\s+average\s+\((\d+)%\)[\s\S]*?10-year\s+average\s+\((\d+)%\)/i;
  const revBeat = all.match(revBeatRe);

  // Revenue surprise: "companies are reporting revenues that are 2.0% above expectations" with hist averages
  const revSurpRe =
    /companies\s+are\s+reporting\s+revenues\s+that\s+are\s+(-?\d+(?:\.\d+)?)%\s+above\s+(?:the\s+)?expectations[\s\S]*?1-year\s+average\s+\(([+\-]?\d+(?:\.\d+)?)%\)[\s\S]*?(?:equal\s+to\s+the|above\s+the|below\s+the)\s+5-year\s+average\s+\(([+\-]?\d+(?:\.\d+)?)%\)[\s\S]*?10-year\s+average\s+\(([+\-]?\d+(?:\.\d+)?)%\)/i;
  const revSurp = all.match(revSurpRe);

  return {
    epsBeat: epsBeatHist
      ? { current: null /* set from keyMetrics */, avg1yr: num(epsBeatHist[1]), avg5yr: num(epsBeatHist[2]), avg10yr: num(epsBeatHist[3]) }
      : { current: null, avg1yr: null, avg5yr: null, avg10yr: null },
    epsSurprise: epsSurp
      ? { current: num(epsSurp[1]), avg1yr: num(epsSurp[2]), avg5yr: num(epsSurp[3]), avg10yr: num(epsSurp[4]) }
      : { current: null, avg1yr: null, avg5yr: null, avg10yr: null },
    revenueBeat: revBeat
      ? { current: num(revBeat[1]), avg1yr: num(revBeat[2]), avg5yr: num(revBeat[3]), avg10yr: num(revBeat[4]) }
      : { current: null, avg1yr: null, avg5yr: null, avg10yr: null },
    revenueSurprise: revSurp
      ? { current: num(revSurp[1]), avg1yr: num(revSurp[2]), avg5yr: num(revSurp[3]), avg10yr: num(revSurp[4]) }
      : { current: null, avg1yr: null, avg5yr: null, avg10yr: null },
  };
}

// Per-sector earnings growth rate (from "Earnings Growth: 15.1%" section commentary)
function extractSectorEarningsGrowth(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const result = {};
  for (const sector of SECTORS) {
    const escaped = sector.replace(/&/g, '&').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Try several phrasings:
    // 1. "[Sector] sector is reporting the highest (year-over-year) earnings growth rate of all eleven sectors at X%"
    // 2. "[Sector] sector is reporting the largest (year-over-year) earnings decline of all eleven sectors at -X%"
    // 3. "blended earnings growth rate for the [Sector] sector increased to X%"
    const patterns = [
      new RegExp(
        `${escaped}\\s+sector\\s+is\\s+reporting\\s+(?:the\\s+(?:highest|largest|second-largest|third-largest|fourth-largest|fifth-largest|sixth-largest)\\s+)?\\(?year-over-year\\)?\\s+earnings\\s+(?:growth|decline)(?:\\s+rate)?\\s+(?:of\\s+all\\s+eleven\\s+sectors\\s+)?at\\s+(-?\\d+(?:\\.\\d+)?)%`,
        'i',
      ),
      new RegExp(
        `blended\\s+earnings\\s+(?:growth\\s+rate|decline)\\s+for\\s+the\\s+${escaped}\\s+sector(?:\\s+(?:has\\s+)?(?:increased|decreased|improved|fell))?\\s+(?:to|of)\\s+(-?\\d+(?:\\.\\d+)?)%`,
        'i',
      ),
    ];
    let value = null;
    for (const re of patterns) {
      const v = matchNum(all, re);
      if (v !== null) {
        value = v;
        break;
      }
    }
    result[sector] = value;
  }
  return result;
}

function extractSectorRevenueGrowth(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const result = {};
  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(
        `${escaped}\\s+sector\\s+is\\s+reporting\\s+(?:the\\s+(?:highest|largest|second-highest|third-highest|fourth-highest|fifth-highest|sixth-highest)\\s+)?\\(?year-over-year\\)?\\s+revenue\\s+growth(?:\\s+rate)?\\s+(?:of\\s+all\\s+eleven\\s+sectors\\s+)?at\\s+(-?\\d+(?:\\.\\d+)?)%`,
        'i',
      ),
      new RegExp(
        `blended\\s+revenue\\s+growth\\s+rate\\s+for\\s+the\\s+${escaped}\\s+sector(?:\\s+(?:has\\s+)?(?:increased|decreased))?\\s+(?:to|of)\\s+(-?\\d+(?:\\.\\d+)?)%`,
        'i',
      ),
    ];
    let value = null;
    for (const re of patterns) {
      const v = matchNum(all, re);
      if (v !== null) {
        value = v;
        break;
      }
    }
    result[sector] = value;
  }
  return result;
}

// Per-sector net profit margin (current + 5yr avg + year-ago).
// Restricted to the "Net Profit Margin" section so we don't pick up margin-shaped pairs
// that actually represent earnings-growth revisions (e.g. "Industrials (16.7% vs. 3.3%)").
function extractSectorMargins(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const marginSection =
    sliceSection(
      all,
      /Net\s+Profit\s+Margin:\s+\d+\.\d+%/i,
      [/Forward\s+Estimates\s+&\s+Valuation/i, /Quarterly\s+Guidance:/i, /Q1\s+\d{4}:\s+Scorecard/i],
    ) || all;

  // Within the margin section, FactSet reports each sector in three contexts:
  //   1. YoY:    "Information Technology (29.1% vs. 25.4%)"
  //   2. 5yr:    "Information Technology (29.1% vs. 25.3%)"
  //   3. QoQ:    "Industrials (11.1% vs. 12.3%)"
  // The first occurrence after the YoY phrase is YoY; after 5yr phrase is 5yr; after QoQ phrase is QoQ.
  const yoyBlock = sliceSection(marginSection, /year-over-year\s+(?:increase|decrease|change)\s+in\s+their\s+net\s+profit\s+margins/i, [/5-year\s+averages?/i, /quarter-over-quarter/i]) || marginSection;
  const fiveYrBlock = sliceSection(marginSection, /(?:above|below)\s+their\s+5-year\s+averages?/i, [/quarter-over-quarter/i]) || marginSection;

  const result = {};
  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s+\\((\\d+(?:\\.\\d+)?)%\\s+vs\\.\\s+(\\d+(?:\\.\\d+)?)%\\)`, 'i');
    const yoyM = yoyBlock.match(re);
    const fiveM = fiveYrBlock.match(re);
    result[sector] = {
      current: yoyM ? num(yoyM[1]) : (fiveM ? num(fiveM[1]) : null),
      yearAgo: yoyM ? num(yoyM[2]) : null,
      avg5yr: fiveM ? num(fiveM[2]) : null,
    };
  }
  return result;
}

// Per-sector EPS surprise % from "Industrials (+33.2%) sector is reporting the largest positive..."
function extractSectorEpsSurprise(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const result = {};
  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${escaped}\\s+\\(([+\\-]?\\d+(?:\\.\\d+)?)%\\)\\s+sector\\s+is\\s+reporting\\s+the\\s+(?:largest|second-largest|third-largest|fourth-largest|fifth-largest|sixth-largest|smallest)\\s+positive\\s+\\(aggregate\\)\\s+difference\\s+between\\s+actual\\s+earnings\\s+and`, 'i'),
      new RegExp(`The\\s+${escaped}\\s+sector\\s+is\\s+reporting\\s+the\\s+(?:largest|second-largest|third-largest|fourth-largest|fifth-largest|sixth-largest|smallest)\\s+(?:positive\\s+)?\\(aggregate\\)\\s+difference\\s+between\\s+actual\\s+earnings\\s+and\\s+estimated\\s+earnings`, 'i'),
    ];
    // The simpler pattern: find "Sector (+X%) sector is reporting"
    const m = all.match(patterns[0]);
    result[sector] = m ? num(m[1]) : null;
  }
  return result;
}

// Per-sector revenue surprise %
function extractSectorRevSurprise(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const result = {};
  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // FactSet uses two phrasings:
    //   "Information Technology (+5.8%) ... largest positive ... actual revenues"
    //   "Consumer Discretionary sector (+0.4%) ... smallest positive ... actual revenues"
    // The second has an extra "sector" word between the name and the percentage.
    const re = new RegExp(`${escaped}(?:\\s+sector)?\\s+\\(([+\\-]?\\d+(?:\\.\\d+)?)%\\)[^.]*?actual\\s+revenues\\s+and\\s+estimated\\s+revenues`, 'i');
    const m = all.match(re);
    result[sector] = m ? num(m[1]) : null;
  }
  return result;
}

// % of companies in each sector beating EPS / revenue.
// FactSet's text combines the highest- and lowest-performing sectors in one
// run-on sentence ("Energy (100%), Health Care (100%), ... sectors have the
// highest percentages ..., while the Consumer Discretionary (69%) sector has
// the lowest percentage ..."). Earlier list items can be 250+ chars before
// the trigger, so we extract the entire surrounding sentence(s) — with
// findSentencesContaining — and scan that combined text for each sector.
function extractSectorBeatPct(pages, metric /* 'earnings' | 'revenues' */) {
  const all = pages.map((p) => p.text).join('\n');
  const triggerRe = new RegExp(
    `sectors?\\s+ha(?:s|ve)\\s+the\\s+(highest|lowest)\\s+percentages?\\s+of\\s+companies\\s+reporting\\s+${metric}\\s+above\\s+estimates`,
    'i',
  );
  const sentences = findSentencesContaining(all, triggerRe);
  const block = sentences.join(' ');
  const result = {};
  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${escaped}\\s+\\((\\d+)%\\)`, 'i');
    const m = block.match(re);
    result[sector] = m ? num(m[1]) : null;
  }
  return result;
}

const extractSectorEpsBeatPct = (pages) => extractSectorBeatPct(pages, 'earnings');
const extractSectorRevBeatPct = (pages) => extractSectorBeatPct(pages, 'revenues');

function extractMarketReaction(pages) {
  const all = pages.map((p) => p.text).join('\n');
  // "average price increase of +0.9% two days before... slightly below the 5-year average price increase of +1.0%"
  const posRe = /positive\s+earnings\s+surprises\s+for\s+Q\d\s+\d{4}\s+have\s+seen\s+an\s+average\s+price\s+(?:increase|decrease|change)\s+of\s+([+\-]?\d+(?:\.\d+)?)%[\s\S]*?5-year\s+average\s+price\s+(?:increase|decrease|change)\s+of\s+([+\-]?\d+(?:\.\d+)?)%/i;
  const negRe = /negative\s+earnings\s+surprises\s+for\s+Q\d\s+\d{4}\s+have\s+seen\s+an\s+average\s+price\s+(?:decrease|increase|change)\s+of\s+([+\-]?\d+(?:\.\d+)?)%[\s\S]*?5-year\s+average\s+price\s+(?:decrease|increase|change)\s+of\s+([+\-]?\d+(?:\.\d+)?)%/i;
  const pos = all.match(posRe);
  const neg = all.match(negRe);
  return {
    positiveSurprise: pos ? { current: num(pos[1]), avg5yr: num(pos[2]) } : { current: null, avg5yr: null },
    negativeSurprise: neg ? { current: num(neg[1]), avg5yr: num(neg[2]) } : { current: null, avg5yr: null },
  };
}

function extractRevisions(pages) {
  const all = pages.map((p) => p.text).join('\n');
  // Earnings: current vs last week vs end of quarter — relax leading "blended..." since
  // FactSet uses different parentheticals: "blended (year-over-year)" or "blended (combines actual...)"
  const earnRe =
    /earnings\s+growth\s+rate\s+for\s+the\s+first\s+quarter\s+is\s+(-?\d+(?:\.\d+)?)%\s+today,\s+compared\s+to\s+an\s+earnings\s+growth\s+rate\s+of\s+(-?\d+(?:\.\d+)?)%\s+last\s+week\s+and\s+an\s+earnings\s+growth\s+rate\s+of\s+(-?\d+(?:\.\d+)?)%\s+at\s+the\s+end\s+of\s+the\s+(?:first|second|third|fourth)\s+quarter/i;
  const earn = all.match(earnRe);
  const revRe =
    /blended\s+revenue\s+growth\s+rate\s+for\s+the\s+first\s+quarter\s+is\s+(-?\d+(?:\.\d+)?)%\s+today,\s+compared\s+to\s+a\s+revenue\s+growth\s+rate\s+of\s+(-?\d+(?:\.\d+)?)%\s+last\s+week\s+and\s+a\s+revenue\s+growth\s+rate\s+of\s+(-?\d+(?:\.\d+)?)%\s+at\s+the\s+end\s+of\s+the\s+(?:first|second|third|fourth)\s+quarter/i;
  const rev = all.match(revRe);

  // Per-sector EARNINGS revisions since end of quarter. Restrict to the earnings-revision
  // sub-section so we don't pick up revenue-revision pairs (which use "to X from Y" syntax for
  // the same sector names).
  const revisionsSection = sliceSection(
    all,
    /Sectors?\s+Have\s+Seen\s+Largest\s+Increases?\s+in\s+Earnings\s+since\s+March\s+31|Largest\s+Increases?\s+in\s+Earnings\s+since\s+March\s+31/i,
    [
      /Sector\s+Has\s+Seen\s+Largest\s+Increase\s+in\s+Revenues/i,
      /Increase\s+in\s+Blended\s+Revenues\s+This\s+Week/i,
      /Earnings\s+Growth:\s+\d+\.\d+%/i,
    ],
  ) || all;

  const sectorChanges = [];
  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const patterns = [
      new RegExp(`${escaped}\\s+\\(to\\s+(-?\\d+(?:\\.\\d+)?)%\\s+from\\s+(-?\\d+(?:\\.\\d+)?)%\\)`, 'i'),
      new RegExp(`${escaped}\\s+\\((-?\\d+(?:\\.\\d+)?)%\\s+vs\\.\\s+(-?\\d+(?:\\.\\d+)?)%\\)`, 'i'),
    ];
    for (const re of patterns) {
      const m = revisionsSection.match(re);
      if (m) {
        sectorChanges.push({ sector, current: num(m[1]), endOfQuarter: num(m[2]) });
        break;
      }
    }
  }

  return {
    earningsGrowth: earn
      ? { current: num(earn[1]), lastWeek: num(earn[2]), endOfQuarter: num(earn[3]) }
      : { current: null, lastWeek: null, endOfQuarter: null },
    revenueGrowth: rev
      ? { current: num(rev[1]), lastWeek: num(rev[2]), endOfQuarter: num(rev[3]) }
      : { current: null, lastWeek: null, endOfQuarter: null },
    sectorSinceQuarterEnd: sectorChanges,
  };
}

function extractForwardEstimates(pages) {
  const all = pages.map((p) => p.text).join('\n');
  // "For Q2 2026, analysts are projecting earnings growth of 20.6% and revenue growth of 10.7%."
  const periodRe = /For\s+(Q[1-4]\s+\d{4}|CY\s+\d{4}),\s+analysts\s+are\s+(?:projecting|predicting|calling\s+for)\s+(?:\(year-over-year\)\s+)?earnings\s+growth\s+(?:rates?\s+)?of\s+(-?\d+(?:\.\d+)?)%(?:\s+and\s+revenue\s+growth\s+of\s+(-?\d+(?:\.\d+)?)%)?/gi;
  const out = {};
  for (const m of all.matchAll(periodRe)) {
    const key = m[1].replace(/\s+/g, '_');
    out[key] = { earningsGrowth: num(m[2]), revenueGrowth: m[3] !== undefined ? num(m[3]) : null };
  }

  // Forward net profit margins: "estimated net profit margins for Q2 2026 through Q4 2026 are 14.1%, 14.6%, and 14.6%"
  const marginRe =
    /estimated\s+net\s+profit\s+margins\s+for\s+(Q[1-4])\s+(\d{4})\s+through\s+(Q[1-4])\s+\d{4}\s+are\s+(\d+(?:\.\d+)?)%,\s*(\d+(?:\.\d+)?)%,\s*and\s+(\d+(?:\.\d+)?)%/i;
  const mm = all.match(marginRe);
  if (mm) {
    const startQ = parseInt(mm[1].slice(1), 10);
    const year = mm[2];
    const margins = [num(mm[4]), num(mm[5]), num(mm[6])];
    for (let i = 0; i < 3; i++) {
      const k = `Q${startQ + i}_${year}`;
      out[k] = out[k] || { earningsGrowth: null, revenueGrowth: null };
      out[k].netProfitMargin = margins[i];
    }
  }

  return out;
}

function extractGuidance(pages) {
  const all = pages.map((p) => p.text).join('\n');
  // "20 companies in the index have issued EPS guidance for Q2 2026. Of these 20 companies, 11 have issued negative EPS guidance and 9 have issued positive"
  const nextQRe =
    /(\d+)\s+companies\s+in\s+the\s+index\s+have\s+issued\s+EPS\s+guidance\s+for\s+(Q[1-4]\s+\d{4})\.\s+Of\s+these\s+\d+\s+companies,\s+(\d+)\s+have\s+issued\s+negative\s+EPS\s+guidance\s+and\s+(\d+)\s+have\s+issued\s+positive/i;
  const m = all.match(nextQRe);

  const negPctRe =
    /percentage\s+of\s+companies\s+issuing\s+negative\s+EPS\s+guidance\s+for\s+Q[1-4]\s+\d{4}\s+is\s+(\d+)%[^.]*?5-year\s+average\s+of\s+(\d+)%[^.]*?10-year\s+average\s+of\s+(\d+)%/i;
  const np = all.match(negPctRe);

  // Full year guidance: "262 companies in the index have issued EPS guidance for the current fiscal year ... 138 have issued negative EPS guidance and 124 have issued positive"
  const fyRe =
    /(\d+)\s+companies\s+in\s+the\s+index\s+have\s+issued\s+EPS\s+guidance\s+for\s+the\s+current\s+fiscal\s+year[^.]*?Of\s+these\s+\d+\s+companies,\s+(\d+)\s+have\s+issued\s+negative\s+EPS\s+guidance\s+and\s+(\d+)\s+have\s+issued\s+positive/i;
  const fy = all.match(fyRe);

  return {
    nextQuarter: m
      ? {
          label: m[2],
          total: num(m[1]),
          negative: num(m[3]),
          positive: num(m[4]),
          negPct: np ? num(np[1]) : null,
          negPct5yr: np ? num(np[2]) : null,
          negPct10yr: np ? num(np[3]) : null,
        }
      : null,
    fullYear: fy
      ? {
          total: num(fy[1]),
          negative: num(fy[2]),
          positive: num(fy[3]),
          negPct: num(fy[2]) && num(fy[1]) ? Math.round((num(fy[2]) / num(fy[1])) * 100) : null,
        }
      : null,
  };
}

function extractValuation(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const fwdEoQ = matchNum(all, /above\s+the\s+forward\s+12-?month\s+P\/E\s+ratio\s+of\s+(\d+(?:\.\d+)?)\s+recorded\s+at\s+the\s+end\s+of\s+the\s+(?:first|second|third|fourth)\s+quarter/i);
  const fwdPe = matchNum(all, /forward\s+12-?month\s+P\/E\s+ratio\s+for\s+the\s+S&P\s*500\s+is\s+(\d+(?:\.\d+)?)/i);
  const fwd5yr = matchNum(all, /forward\s+12-?month\s+P\/E\s+ratio[\s\S]{0,200}?5-year\s+average\s+(?:of\s+)?\((\d+(?:\.\d+)?)\)/i)
    ?? matchNum(all, /This\s+P\/E\s+ratio\s+is\s+above\s+the\s+5-year\s+average\s+of\s+(\d+(?:\.\d+)?)/i);
  const fwd10yr = matchNum(all, /forward\s+12-?month\s+P\/E\s+ratio[\s\S]{0,200}?10-year\s+average\s+(?:of\s+)?\((\d+(?:\.\d+)?)\)/i)
    ?? matchNum(all, /and\s+above\s+the\s+10-year\s+average\s+of\s+(\d+(?:\.\d+)?)/i);

  const trail = matchNum(all, /trailing\s+12-?month\s+P\/E\s+ratio\s+is\s+(\d+(?:\.\d+)?)/i);
  const trail5yr = matchNum(all, /trailing\s+12-?month\s+P\/E\s+ratio[\s\S]{0,150}?5-year\s+average\s+of\s+(\d+(?:\.\d+)?)/i);
  const trail10yr = matchNum(all, /trailing\s+12-?month\s+P\/E\s+ratio[\s\S]{0,200}?10-year\s+average\s+of\s+(\d+(?:\.\d+)?)/i);

  // Sector P/E callouts: "the Consumer Discretionary (28.2) sector has the highest forward 12-month P/E ratio, while the Energy (14.6) and Financials (14.8) sectors have the lowest forward 12-month P/E ratios"
  const sectorFwdPe = [];
  const sectorPeBlock = all.match(
    /At\s+the\s+sector\s+level,\s+the\s+[A-Z][\s\S]{0,400}?lowest\s+forward\s+12-?month\s+P\/E\s+ratios?\./i,
  );
  if (sectorPeBlock) {
    for (const sector of SECTORS) {
      const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${escaped}\\s+\\((\\d+(?:\\.\\d+)?)\\)`, 'i');
      const m = sectorPeBlock[0].match(re);
      if (m) sectorFwdPe.push({ sector, fwdPe: num(m[1]) });
    }
  }

  return {
    fwdPe: { current: fwdPe, avg5yr: fwd5yr, avg10yr: fwd10yr, endOfQuarter: fwdEoQ },
    trailingPe: { current: trail, avg5yr: trail5yr, avg10yr: trail10yr },
    sectorFwdPe,
  };
}

function extractTargets(pages) {
  const all = pages.map((p) => p.text).join('\n');
  // "bottom-up target price for the S&P 500 is 8362.16, which is 17.6% above the closing price of 7108.40"
  const tgt = all.match(
    /bottom-up\s+target\s+price\s+for\s+the\s+S&P\s*500\s+is\s+([\d,]+(?:\.\d+)?),\s+which\s+is\s+(-?\d+(?:\.\d+)?)%\s+above\s+the\s+closing\s+price\s+of\s+([\d,]+(?:\.\d+)?)/i,
  );

  // Two blocks: "largest" and "smallest" price increases. Capture them both via one wider span,
  // then extract every "Sector (+X%)" inside.
  const sectorUpside = [];
  const upsideBlock = all.match(
    /At\s+the\s+sector\s+level,\s+the\s+[A-Z][\s\S]{0,1200}?smallest\s+price\s+(?:increase|decrease)s?[^.]*?\./i,
  );
  if (upsideBlock) {
    for (const sector of SECTORS) {
      const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${escaped}\\s+\\(([+\\-]?\\d+(?:\\.\\d+)?)%\\)`, 'i');
      const m = upsideBlock[0].match(re);
      if (m) sectorUpside.push({ sector, upsidePct: num(m[1]) });
    }
  }

  return tgt
    ? {
        bottomUpTarget: num(tgt[1]),
        upsidePct: num(tgt[2]),
        currentPrice: num(tgt[3]),
        sectorUpside,
      }
    : { bottomUpTarget: null, upsidePct: null, currentPrice: null, sectorUpside };
}

function extractRatings(pages) {
  const all = pages.map((p) => p.text).join('\n');
  // "12,941 ratings on stocks in the S&P 500. Of these 12,941 ratings, 58.4% are Buy ratings, 36.3% are Hold ratings, and 5.3% are Sell ratings"
  const m = all.match(
    /([\d,]+)\s+ratings\s+on\s+stocks\s+in\s+the\s+S&P\s*500[\s\S]*?(\d+(?:\.\d+)?)%\s+are\s+Buy\s+ratings,\s+(\d+(?:\.\d+)?)%\s+are\s+Hold\s+ratings,\s+and\s+(\d+(?:\.\d+)?)%\s+are\s+Sell/i,
  );
  // Sector buy % — both highest and lowest percentages live in one sentence pair.
  const sectorBuyPct = [];
  const buyBlock = all.match(
    /At\s+the\s+sector\s+level,\s+the\s+[A-Z][\s\S]{0,800}?sectors?\s+have\s+the\s+lowest\s+percentages?\s+of\s+Buy\s+ratings/i,
  );
  if (buyBlock) {
    for (const sector of SECTORS) {
      const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${escaped}\\s+\\((\\d+)%\\)`, 'i');
      const mm = buyBlock[0].match(re);
      if (mm) sectorBuyPct.push({ sector, buyPct: num(mm[1]) });
    }
  }

  return m
    ? {
        totalRatings: num(m[1]),
        buyPct: num(m[2]),
        holdPct: num(m[3]),
        sellPct: num(m[4]),
        sectorBuyPct,
      }
    : { totalRatings: null, buyPct: null, holdPct: null, sellPct: null, sectorBuyPct };
}

function extractNetProfitMargin(pages) {
  const all = pages.map((p) => p.text).join('\n');
  // "blended net profit margin for the S&P 500 for Q1 2026 is 13.4%, which is above the previous quarter's net profit margin of 13.2%, above the year-ago net profit margin of 12.8%, and above the 5-year average of 12.3%."
  const m = all.match(
    /blended\s+net\s+profit\s+margin\s+for\s+the\s+S&P\s*500\s+for\s+Q[1-4]\s+\d{4}\s+is\s+(\d+(?:\.\d+)?)%[\s\S]*?previous\s+quarter[^0-9]*?(\d+(?:\.\d+)?)%[\s\S]*?year-ago\s+net\s+profit\s+margin\s+of\s+(\d+(?:\.\d+)?)%[\s\S]*?5-year\s+average\s+of\s+(\d+(?:\.\d+)?)%/i,
  );
  return m
    ? { current: num(m[1]), previousQuarter: num(m[2]), yearAgo: num(m[3]), avg5yr: num(m[4]) }
    : { current: null, previousQuarter: null, yearAgo: null, avg5yr: null };
}

function extractNextWeek(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const m = all.match(
    /(\d+)\s+S&P\s*500\s+companies\s+\(including\s+(\d+)\s+Dow\s*30\s+components\)\s+are\s+scheduled\s+to\s+report/i,
  );
  return m ? { companiesReporting: num(m[1]), dow30Components: num(m[2]) } : { companiesReporting: null, dow30Components: null };
}

// Industry-level breakdown within each sector
function extractSectorIndustries(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const result = {};
  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const earnings = [];
    const revenue = [];

    // Find earnings industry block: "all 6 industries in the sector are reporting year-over-year earnings growth: Semiconductors & Semiconductor Equipment (98%), Technology Hardware..."
    const earnBlockRe = new RegExp(
      `${escaped}[\\s\\S]{0,200}?(?:industries?\\s+in\\s+the\\s+sector\\s+are\\s+reporting|industries?\\s+are\\s+reporting)\\s+(?:year-over-year\\s+)?(?:earnings\\s+growth|growth\\s+in\\s+earnings|a\\s+year-over-year\\s+(?:decline|growth)\\s+in\\s+earnings):\\s*([^.]+?\\.)`,
      'gi',
    );
    for (const m of all.matchAll(earnBlockRe)) {
      const block = m[1];
      const itemRe = /([A-Z][A-Za-z &,\-\/]+?)\s+\((-?\d+(?:\.\d+)?)%\)/g;
      for (const im of block.matchAll(itemRe)) {
        earnings.push({ industry: im[1].trim().replace(/\s+/g, ' '), growth: num(im[2]) });
      }
    }

    const revBlockRe = new RegExp(
      `${escaped}[\\s\\S]{0,200}?(?:industries?\\s+in\\s+the\\s+sector\\s+are\\s+reporting|industries?\\s+are\\s+reporting)\\s+(?:year-over-year\\s+)?revenue\\s+growth:\\s*([^.]+?\\.)`,
      'gi',
    );
    for (const m of all.matchAll(revBlockRe)) {
      const block = m[1];
      const itemRe = /([A-Z][A-Za-z &,\-\/]+?)\s+\((-?\d+(?:\.\d+)?)%\)/g;
      for (const im of block.matchAll(itemRe)) {
        revenue.push({ industry: im[1].trim().replace(/\s+/g, ' '), growth: num(im[2]) });
      }
    }

    if (earnings.length || revenue.length) result[sector] = { earnings, revenue };
  }
  return result;
}

// Per-sector contributing companies and ex-contributor sensitivity.
//
// Two strategies, results combined and de-duped per sector:
//   1. Anchor on the "If [these/this] ... excluded ... [Sector] sector would..."
//      sentence (which names the sector). Look backwards from that sentence,
//      bounded at the most recent contributor-sentence marker ("At the company
//      level" / "Within this sector" / "Within the <Sector> sector" / "At the
//      industry level"), to extract the company-vs-estimate pairs.
//   2. Find any contributor sentence that names the sector explicitly:
//      "[start marker] ... contributor[s] to ... [Sector] sector".
//
// Strategy 1 also yields the ex-contributor adjusted/full growth values.
function extractCompanyContributors(pages) {
  const all = pages.map((p) => p.text).join('\n');
  const result = {};

  const companyRe = /(?:^|[\s,;:.])([A-Z][A-Za-z0-9'&\.\-][A-Za-z0-9 '&\.\-]*?)\s+\(\s*(-?\$?[\d,.]+)\s*(?:million|billion)?\s*vs\.\s+(-?\$?[\d,.]+)\s*(?:million|billion)?\s*\)/g;
  const STOP_WORDS = /^(within|outside|the|in|at|this|these|of|by|for|from|to|and|sector|company|companies|industry|industries|while|however|also|both|either|neither|since|including|excluding|with|where|when)$/i;

  const extractCompanies = (block) => {
    const out = [];
    const seen = new Set();
    for (const m of block.matchAll(companyRe)) {
      let company = m[1].trim().replace(/\s+/g, ' ');
      const lastComma = company.lastIndexOf(',');
      if (lastComma >= 0) company = company.slice(lastComma + 1).trim();
      const tokens = company.split(/\s+/);
      while (tokens.length > 1 && STOP_WORDS.test(tokens[0])) tokens.shift();
      company = tokens.join(' ');
      if (company.length < 2 || company.length > 50) continue;
      if (seen.has(company)) continue;
      seen.add(company);
      out.push({ company, actual: num(m[2]), estimate: num(m[3]) });
    }
    return out;
  };

  // Markers that begin a contributor sentence — used to bound the lookback window.
  const startMarkerRe = /(At\s+the\s+company\s+level|Within\s+this\s+sector|Within\s+the\s+[A-Z][A-Za-z &]+sector|At\s+the\s+industry\s+level)\b,?/gi;

  for (const sector of SECTORS) {
    const escaped = sector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const blockTexts = [];
    let exContributor = null;

    // Strategy 1: ex-contributor sensitivity anchor. Two phrasings:
    //   (a) "...sector would [fall|improve|...] from X% to Y%" / "to X% from Y%"
    //   (b) "...sector would be reporting earnings growth of X% rather than an
    //        earnings decline of Y%"
    const anchorRe = new RegExp(
      `If\\s+(?:this|these)[\\s\\S]{0,200}?(?:were\\s+)?excluded[\\s\\S]{0,400}?${escaped}\\s+sector\\s+would\\s+(?:(?:fall|improve|increase|decrease|swing|rise|drop)\\s+(?:from\\s+(-?\\d+(?:\\.\\d+)?)%[^.]*?to\\s+(-?\\d+(?:\\.\\d+)?)%|to\\s+(-?\\d+(?:\\.\\d+)?)%\\s+from\\s+(-?\\d+(?:\\.\\d+)?)%)|be\\s+reporting\\s+(?:an?\\s+)?earnings\\s+(?:growth|decline|increase|decrease)\\s+of\\s+(-?\\d+(?:\\.\\d+)?)%\\s+rather\\s+than\\s+(?:an?\\s+)?earnings\\s+(?:growth|decline|increase|decrease)\\s+of\\s+(-?\\d+(?:\\.\\d+)?)%)`,
      'gi',
    );
    const anchorMatches = [...all.matchAll(anchorRe)];
    if (anchorMatches.length > 0) {
      const a = anchorMatches[0];
      // Look backwards from anchor start, bounded at the LAST contributor-sentence
      // marker before the anchor (so we don't cross into a previous sector's block).
      const lookback = Math.min(800, a.index);
      const backStart = a.index - lookback;
      const back = all.slice(backStart, a.index);
      let bestStart = backStart;
      for (const sm of [...back.matchAll(startMarkerRe)]) {
        bestStart = backStart + sm.index;
      }
      blockTexts.push(all.slice(bestStart, a.index));

      // Decode adjusted/full from whichever capture group set fired.
      let adjustedGrowth, fullGrowth;
      if (a[1] !== undefined && a[2] !== undefined) {
        // "from X% to Y%" — X is full (with), Y is adjusted (without)
        fullGrowth = num(a[1]);
        adjustedGrowth = num(a[2]);
      } else if (a[3] !== undefined && a[4] !== undefined) {
        // "to X% from Y%" — X is adjusted, Y is full
        adjustedGrowth = num(a[3]);
        fullGrowth = num(a[4]);
      } else if (a[5] !== undefined && a[6] !== undefined) {
        // "would be reporting growth of X% rather than decline of Y%"
        adjustedGrowth = num(a[5]);
        fullGrowth = num(a[6]);
      }
      exContributor = { excluding: [], adjustedGrowth, fullGrowth };
    }

    // Strategy 2: contributor sentence that explicitly names this sector.
    //   "...contributor[s] to ... [Sector] sector"
    const explicitRe = new RegExp(
      `(?:At\\s+the\\s+company\\s+level|Within\\s+(?:this|the\\s+${escaped})\\s+sector|At\\s+the\\s+industry\\s+level)[^.]{0,800}?contributors?\\s+to[^.]{0,300}?${escaped}\\s+sector`,
      'gi',
    );
    for (const m of all.matchAll(explicitRe)) {
      blockTexts.push(m[0]);
    }

    // Strategy 3: section header like "Health Care: Merck & Company is Largest
    //   Contributor to Year-Over-Year Decline" — take ~800 chars after the header.
    const headerRe = new RegExp(
      `${escaped}:\\s+[^:]{0,200}?(?:is\\s+(?:the\\s+)?Largest|are\\s+(?:the\\s+)?Largest)\\s+Contributors?`,
      'gi',
    );
    for (const m of all.matchAll(headerRe)) {
      const start = m.index;
      const end = Math.min(all.length, start + 1200);
      // Truncate at next sector header to stay within this section.
      const tail = all.slice(start + m[0].length, end);
      const otherSectorHeader = SECTORS.filter((s) => s !== sector)
        .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      const stopRe = new RegExp(`\\b(?:${otherSectorHeader}):\\s+`, 'i');
      const stopIdx = tail.search(stopRe);
      const blockEnd = stopIdx > -1 ? start + m[0].length + stopIdx : end;
      blockTexts.push(all.slice(start, blockEnd));
    }

    const seen = new Set();
    const companies = [];
    for (const block of blockTexts) {
      for (const c of extractCompanies(block)) {
        if (seen.has(c.company)) continue;
        seen.add(c.company);
        companies.push(c);
      }
    }
    if (exContributor) {
      exContributor.excluding = companies.map((c) => c.company);
    }

    if (companies.length || exContributor) result[sector] = { companies, exContributor };
  }
  return result;
}

// ---- top-level ------------------------------------------------------------

// Normalize text extracted from PDF:
//   - Join hyphenated line breaks ("10-\nyear" → "10-year")
//   - Replace single newlines with spaces; collapse multi-newlines to one
//   - Collapse runs of whitespace
// Without this, regex patterns that span "5-year average" / "10-year average"
// fail because pdf-parse wraps mid-word with a hyphen + newline.
function normalize(text) {
  return text
    .replace(/-\n\s*/g, '-')      // join hyphenated wraps
    .replace(/\n+/g, ' ')           // newlines → spaces
    .replace(/[ \t]+/g, ' ')        // collapse spaces
    .trim();
}

export async function parseFactsetPdf(pdfPath) {
  const buffer = readFileSync(pdfPath);
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  const pages = result.pages.map((p, i) => ({ num: i + 1, text: normalize(p.text || '') }));

  const meta = extractMeta(pages, pdfPath);
  const keyMetrics = extractKeyMetrics(pages);
  const scorecard = extractScorecard(pages);
  // patch in current values from keyMetrics into scorecard (PDF mentions them in different places)
  scorecard.epsBeat.current = keyMetrics.pctBeatEps;
  scorecard.revenueBeat.current = scorecard.revenueBeat.current ?? keyMetrics.pctBeatRevenue;

  const sectorEarn = extractSectorEarningsGrowth(pages);
  const sectorRev = extractSectorRevenueGrowth(pages);
  const sectorMargins = extractSectorMargins(pages);
  const sectorEpsSurp = extractSectorEpsSurprise(pages);
  const sectorRevSurp = extractSectorRevSurprise(pages);
  const sectorEpsBeat = extractSectorEpsBeatPct(pages);
  const sectorRevBeat = extractSectorRevBeatPct(pages);
  const npmAggregate = extractNetProfitMargin(pages);

  // Chart extraction (OCR of bar-chart pages 17/20/22) fills sector cells the
  // narrative leaves blank. FactSet's prose only spotlights 5–6 sectors per
  // metric; the bar charts publish all 11.
  //
  // Pass narrative-extracted values + index aggregates into the OCR pipeline
  // so it can recover from garbled chart labels: a chart bar whose value
  // matches exactly one narrative sector gets assigned to that sector even
  // when its column header OCR'd as gibberish, and bars matching the S&P 500
  // aggregate (e.g. blended +13.4% margin) are dropped instead of being
  // confused for a sector.
  const narrativeMatrix = {
    epsBeatPct: sectorEpsBeat,
    revBeatPct: sectorRevBeat,
    epsSurprise: sectorEpsSurp,
    revSurprise: sectorRevSurp,
    earningsGrowth: sectorEarn,
    revenueGrowth: sectorRev,
    netProfitMargin: Object.fromEntries(SECTORS.map((s) => [s, sectorMargins[s]?.current ?? null])),
  };
  const blendedAggregates = {
    epsBeatPct: scorecard.epsBeat.current,
    revBeatPct: scorecard.revenueBeat.current,
    epsSurprise: scorecard.epsSurprise.current,
    revSurprise: scorecard.revenueSurprise.current,
    earningsGrowth: keyMetrics.blendedEarningsGrowth,
    revenueGrowth: keyMetrics.blendedRevenueGrowth,
    netProfitMargin: npmAggregate.current,
  };

  let sectorCharts = {};
  try {
    sectorCharts = await extractSectorCharts(pdfPath, { narrativeMatrix, blendedAggregates });
  } catch (e) {
    console.error('[parseFactsetPdf] chart extraction failed (continuing without charts):', e.message);
  }

  // Merge: prefer narrative value (more precise wording, fewer OCR risks); fall
  // back to chart value where narrative left null. Track source per cell so the
  // workbook + site can cite "narrative-pX" vs "chart-pX".
  const chartVal = (kind, sector) => sectorCharts[kind]?.values?.[sector] ?? null;
  const chartPage = (kind) => sectorCharts[kind]?.page ?? null;
  const pickWithSource = (narrativeVal, narrativeSrc, chartKind, sector) => {
    if (narrativeVal != null) return { value: narrativeVal, source: narrativeSrc };
    const cv = chartVal(chartKind, sector);
    if (cv != null) return { value: cv, source: `chart-p${chartPage(chartKind)}` };
    return { value: null, source: null };
  };

  const sectorMatrix = [];
  const sectorMatrixSource = {};
  for (const sector of SECTORS) {
    const epsBeat = pickWithSource(sectorEpsBeat[sector], 'narrative', 'epsBeatPct', sector);
    const revBeat = pickWithSource(sectorRevBeat[sector], 'narrative', 'revBeatPct', sector);
    const eps = pickWithSource(sectorEpsSurp[sector], 'narrative', 'epsSurprise', sector);
    const rev = pickWithSource(sectorRevSurp[sector], 'narrative', 'revSurprise', sector);
    const earn = pickWithSource(sectorEarn[sector], 'narrative', 'earningsGrowth', sector);
    const revG = pickWithSource(sectorRev[sector], 'narrative', 'revenueGrowth', sector);
    const npm = pickWithSource(sectorMargins[sector]?.current ?? null, 'narrative', 'netProfitMargin', sector);
    sectorMatrix.push({
      sector,
      epsBeatPct: epsBeat.value,
      revBeatPct: revBeat.value,
      epsSurprise: eps.value,
      revSurprise: rev.value,
      earningsGrowth: earn.value,
      revenueGrowth: revG.value,
      netProfitMargin: npm.value,
      netProfitMargin5yr: sectorMargins[sector]?.avg5yr ?? null,
      netProfitMarginYearAgo: sectorMargins[sector]?.yearAgo ?? null,
    });
    sectorMatrixSource[sector] = {
      epsBeatPct: epsBeat.source,
      revBeatPct: revBeat.source,
      epsSurprise: eps.source,
      revSurprise: rev.source,
      earningsGrowth: earn.source,
      revenueGrowth: revG.source,
      netProfitMargin: npm.source,
    };
  }

  return {
    meta,
    keyMetrics,
    scorecard,
    sectorMatrix,
    sectorMatrixSource,
    sectorIndustries: extractSectorIndustries(pages),
    companyContributors: extractCompanyContributors(pages),
    marketReaction: extractMarketReaction(pages),
    revisions: extractRevisions(pages),
    forwardEstimates: extractForwardEstimates(pages),
    guidance: extractGuidance(pages),
    valuation: extractValuation(pages),
    targets: extractTargets(pages),
    ratings: extractRatings(pages),
    netProfitMargin: npmAggregate,
    nextWeek: extractNextWeek(pages),
  };
}
