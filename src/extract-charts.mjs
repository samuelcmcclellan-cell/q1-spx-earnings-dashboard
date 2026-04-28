// extract-charts.mjs — OCR-based extraction of all-11-sector data from
// FactSet's bar chart pages (16–35).
//
// Why OCR: chart pages contain a single embedded raster image per chart;
// pdfjs-dist's getTextContent() returns only the page header/footer/title.
// The actual sector labels and percentages are part of the rasterized chart.
//
// Pipeline per page:
//   1. Render the PDF page to a 5x-scale PNG via pdfjs-dist + @napi-rs/canvas.
//   2. OCR with tesseract.js using PSM SPARSE_TEXT (best for table-style data).
//   3. Spatially group OCR'd words: rows by Y-coordinate, columns by X.
//   4. Map sector header words → numeric values per chart layout.
//
// Two chart layouts are handled:
//   A. Horizontal bars (page 17 — Surprise charts): sector labels on the left,
//      one value per row at the right end of each bar. Match by Y.
//   B. Vertical bars with data table (pages 20, 22 — Growth, Net Profit Margin):
//      sector names in a header row above two value rows ("Today" + comparison).
//      Match value column to sector column by X.

import fs from 'node:fs';
import { createWorker, PSM } from 'tesseract.js';
import { createCanvas } from '@napi-rs/canvas';

// FactSet uses abbreviated sector labels in charts. Map them to our schema names.
const SECTOR_ALIASES = {
  'information technology': 'Information Technology',
  'info. technology': 'Information Technology',
  'info technology': 'Information Technology',
  'communication services': 'Communication Services',
  'comm. services': 'Communication Services',
  'comm services': 'Communication Services',
  'consumer discretionary': 'Consumer Discretionary',
  'consumer disc.': 'Consumer Discretionary',
  'consumer disc': 'Consumer Discretionary',
  'consumer staples': 'Consumer Staples',
  'health care': 'Health Care',
  'real estate': 'Real Estate',
  'financials': 'Financials',
  'industrials': 'Industrials',
  'materials': 'Materials',
  'utilities': 'Utilities',
  'energy': 'Energy',
};

const ALL_SECTORS = [
  'Communication Services', 'Consumer Discretionary', 'Consumer Staples',
  'Energy', 'Financials', 'Health Care', 'Industrials',
  'Information Technology', 'Materials', 'Real Estate', 'Utilities',
];

// Chart layouts to extract. We don't hardcode page numbers — FactSet's report
// length varies week to week, so we scan a small candidate range and detect
// the chart by its title text. `pageRange` is [first, last] inclusive.
//
// `currentRowKeywords` is the row-label text identifying the current-period
// data row inside the data table beneath each vertical bar chart. FactSet
// uses "Today" for growth/surprise charts but "Q126" for the margin chart.
//
// `valueBound` is the maximum plausible absolute value for this metric.
// OCR sometimes loses the decimal point (e.g. "33.2%" → "332%"); we recover
// by dividing values that exceed the bound by 10.
const CHART_TARGETS = [
  { pageRange: [14, 19], kind: 'epsSurprise',     layout: 'horizontal',    titleKeywords: ['Earnings', 'Surprise'], valueBound: 100 },
  { pageRange: [14, 19], kind: 'revSurprise',     layout: 'horizontal',    titleKeywords: ['Revenue', 'Surprise'],  valueBound: 20 },
  { pageRange: [18, 22], kind: 'earningsGrowth',  layout: 'verticalTable', titleKeywords: ['Earnings', 'Growth'],   valueBound: 100, currentRowKeywords: ['Today'] },
  { pageRange: [18, 22], kind: 'revenueGrowth',   layout: 'verticalTable', titleKeywords: ['Revenue', 'Growth'],    valueBound: 100, currentRowKeywords: ['Today'] },
  { pageRange: [20, 24], kind: 'netProfitMargin', layout: 'verticalTable', titleKeywords: ['S&P', 'Margins'],       valueBound: 60,  currentRowKeywords: ['Q126'] },
];

// ---- helpers --------------------------------------------------------------

const normSector = (raw) => SECTOR_ALIASES[raw.toLowerCase().trim()] ?? null;

const isNumericPct = (s) => /^-?\d+(\.\d+)?%$/.test(s);
const numericValue = (s) => parseFloat(s.replace(/%/g, ''));

// OCR sometimes drops the decimal point (e.g. "33.2%" → "332%"). For each chart
// kind we know a plausible upper bound; values exceeding it are very likely
// missing-decimal artifacts. Dividing by 10 recovers the true reading.
function correctValue(v, bound) {
  if (v == null || !Number.isFinite(v)) return null;
  if (Math.abs(v) <= bound) return v;
  const corrected = v / 10;
  if (Math.abs(corrected) <= bound) return corrected;
  return null; // clearly garbage, drop it
}

// Words returned by tesseract have a bbox; collapse to a center point for
// spatial matching.
const cx = (w) => (w.bbox.x0 + w.bbox.x1) / 2;
const cy = (w) => (w.bbox.y0 + w.bbox.y1) / 2;

// Tesseract sometimes splits "-14.4%" into two adjacent words ("-14." + "4%").
// Walk the word list and merge adjacent fragments that together form a number.
function mergeSplitNumbers(words) {
  const out = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const next = words[i + 1];
    if (
      next &&
      Math.abs(cy(w) - cy(next)) < 8 &&
      next.bbox.x0 - w.bbox.x1 < 25 &&
      /^-?\d+\.$/.test(w.text) &&
      /^\d+%$/.test(next.text)
    ) {
      out.push({
        text: w.text + next.text,
        bbox: {
          x0: w.bbox.x0,
          y0: Math.min(w.bbox.y0, next.bbox.y0),
          x1: next.bbox.x1,
          y1: Math.max(w.bbox.y1, next.bbox.y1),
        },
        confidence: Math.min(w.confidence, next.confidence),
      });
      i++; // skip merged
    } else {
      out.push(w);
    }
  }
  return out;
}

// Horizontal bar chart: each row has [sector label, ...optional axis tick..., value%].
// Group rows by Y, then within each row the rightmost numeric word is the value.
// Restrict to words that fall within the chart's vertical extent.
function extractHorizontalBars(words, target) {
  // 1. Locate the chart by finding its title — words on the same Y matching all title keywords.
  const titleY = findTitleY(words, target.titleKeywords);
  if (titleY == null) return {};

  // 2. Find the next chart's title (or page footer) to bound this chart.
  const nextBoundary = findNextChartBoundary(words, titleY);

  // 3. Filter words to this chart's vertical band.
  const chartWords = words.filter((w) => cy(w) > titleY + 30 && cy(w) < nextBoundary);

  // 4. Group by Y row.
  const rows = groupByY(chartWords, 12);

  // 5. For each row, look for a sector label (left side) and a value (right side).
  const result = {};
  for (const row of rows) {
    const sorted = [...row].sort((a, b) => cx(a) - cx(b));
    // Try to assemble a sector name from the leftmost 1-3 words.
    const sector = matchLeftSectorLabel(sorted);
    if (!sector) continue;
    // Value: rightmost numeric word.
    const valueWord = [...sorted].reverse().find((w) => isNumericPct(w.text));
    if (!valueWord) continue;
    const v = correctValue(numericValue(valueWord.text), target.valueBound);
    if (v == null) continue;
    result[sector] = v;
  }
  return result;
}

// Vertical bar chart with data table: a current-period row of values aligned
// under a header row of sector names. Header row may span 2 visual rows (e.g.
// "Info." / "Technology" stacked). We anchor on the current row label,
// grab all numeric values on its row, then match each value's X to the
// closest sector header X.
function extractVerticalTable(words, target) {
  const titleY = findTitleY(words, target.titleKeywords);
  if (titleY == null) {
    if (target._debug) console.error(`[debug] no title found for ${target.kind}, keywords=${target.titleKeywords}`);
    return {};
  }

  const nextBoundary = findNextChartBoundary(words, titleY);
  const chartWords = words.filter((w) => cy(w) > titleY + 30 && cy(w) < nextBoundary);
  if (target._debug) console.error(`[debug] ${target.kind}: titleY=${titleY} nextBoundary=${nextBoundary} chartWords=${chartWords.length}`);

  // 1. Find anchor word — the current-period row label. OCR sometimes prefixes
  //    it with the legend marker character ("=Today", "mQ126", "■Today").
  //    Restrict to words below the chart title to avoid matching page headings.
  const anchorPatterns = (target.currentRowKeywords ?? ['Today']).map(
    (k) => new RegExp(`^[=\\-■▪m]*${k}$`, 'i'),
  );
  const anchor = chartWords.find(
    (w) => cy(w) > titleY + 100 && anchorPatterns.some((re) => re.test(w.text)),
  );
  if (!anchor) {
    if (target._debug) {
      const candidates = chartWords.filter((w) => cy(w) > titleY + 100);
      console.error(`[debug] no anchor found for ${target.kind}. patterns=${anchorPatterns.map(String)}`);
      console.error(`[debug] candidates after titleY+100:`, candidates.slice(0, 10).map((w) => `"${w.text}" y=${cy(w).toFixed(0)}`).join(', '));
    }
    return {};
  }
  const anchorY = cy(anchor);
  const anchorX = cx(anchor);

  // 2. Get all numeric values on the anchor row, to the right of the anchor's X.
  const rowValues = chartWords
    .filter((w) => Math.abs(cy(w) - anchorY) < 15 && cx(w) > anchorX && isNumericPct(w.text))
    .sort((a, b) => cx(a) - cx(b));

  if (target._debug) {
    console.error(`[debug] ${target.kind}: anchor="${anchor.text}" cy=${anchorY.toFixed(0)} cx=${anchorX.toFixed(0)} rowValues=${rowValues.length} (${rowValues.map((w) => w.text).join(',')})`);
  }
  if (rowValues.length === 0) return {};

  // 3. Find header row words ABOVE the anchor (within ~130px) that aren't axis labels.
  //    The header row contains sector names — possibly wrapped to 2 visual rows.
  const headerCandidates = chartWords.filter(
    (w) => cy(w) < anchorY - 5 && cy(w) > anchorY - 130 && cx(w) > anchorX - 30,
  );

  // 4. Build sector "columns": cluster header words by X, then assemble the
  //    full label by combining stacked words (similar X across two rows).
  const sectorColumns = clusterHeaderIntoSectors(headerCandidates);
  if (target._debug) {
    console.error(`[debug] ${target.kind}: sectorColumns=${sectorColumns.length} ${sectorColumns.map((c) => `[${c.x.toFixed(0)}]"${c.label}"`).join(' ')}`);
  }

  // 5. Match each value to the nearest sector column by X.
  const result = {};
  for (const val of rowValues) {
    let best = null;
    let bestDist = Infinity;
    for (const col of sectorColumns) {
      const d = Math.abs(col.x - cx(val));
      if (d < bestDist) {
        bestDist = d;
        best = col;
      }
    }
    if (!best || bestDist > 90) continue;
    const sector = normSector(best.label);
    if (!sector) continue;
    if (!(sector in result)) {
      const v = correctValue(numericValue(val.text), target.valueBound);
      if (v != null) result[sector] = v;
    }
  }
  return result;
}

// Search the header words for known sector labels using token patterns.
// Each sector has a list of alternative token-lists (`alts`); we try each
// alt in order. An alt matches if every regex in it matches a header word,
// and (for pairs) the words are within a tight spatial window.
//
// Multiple alts let us recover from OCR garbling: e.g. Information Technology
// usually OCRs as "Info." + "Technology" (strict), but sometimes the abbrev
// glyph is butchered into a single garbled word like "Techmaioay" — the
// fallback `[/^Tech/i]` catches that case.
//
// After pattern matching, a Consumer-pairing pass handles the case where
// "Discretionary" OCRs as garbage: if we found Consumer Staples but not
// Consumer Discretionary, an unused "Consumer" word becomes Disc.
const SECTOR_TOKENS = [
  { sector: 'Information Technology', alts: [
    [/^Info/i, /Tech/i],   // canonical: "Info." / "Technology"
    [/^Tech/i],            // fallback: "Tech" alone or garbled "Techmaioay"
  ]},
  { sector: 'Communication Services', alts: [
    [/^Comm/i, /Serv/i],
    [/^Comm/i],
    [/^Som/i],             // OCR S/C confusion: "Som," for "Comm."
  ]},
  { sector: 'Consumer Discretionary', alts: [[/^Consumer/i, /Disc/i]] },
  { sector: 'Consumer Staples',       alts: [[/^Consumer/i, /Stapl/i]] },
  { sector: 'Health Care', alts: [
    [/^Health/i, /Care/i],
    [/^Health/i],
  ]},
  { sector: 'Real Estate', alts: [
    [/^Real/i, /Esta?t/i],
    [/^Real/i],
    [/^Esta?t/i],
  ]},
  { sector: 'Materials',  alts: [[/^Material/i]] },
  { sector: 'Financials', alts: [[/^Financ/i]] },
  { sector: 'Industrials', alts: [[/^Industr/i]] },
  { sector: 'Utilities', alts: [
    [/^Utilit/i],
    [/^Litilit/i],         // OCR error: "U" → "Li"
    [/tilit/i],
  ]},
  { sector: 'Energy', alts: [[/^Energy$/i]] },
];

function clusterHeaderIntoSectors(words) {
  const sectorColumns = [];
  const used = new Set();

  const tryAlt = (alt) => {
    if (alt.length === 1) {
      for (let i = 0; i < words.length; i++) {
        if (used.has(i)) continue;
        if (alt[0].test(stripPunct(words[i].text))) return [i];
      }
      return null;
    }
    let best = null;
    let bestDist = Infinity;
    for (let i = 0; i < words.length; i++) {
      if (used.has(i)) continue;
      if (!alt[0].test(stripPunct(words[i].text))) continue;
      for (let j = 0; j < words.length; j++) {
        if (j === i || used.has(j)) continue;
        if (!alt[1].test(stripPunct(words[j].text))) continue;
        const dx = Math.abs(cx(words[i]) - cx(words[j]));
        const dy = Math.abs(cy(words[i]) - cy(words[j]));
        if (dx > 150 || dy > 60) continue;
        const dist = dx + dy;
        if (dist < bestDist) { bestDist = dist; best = [i, j]; }
      }
    }
    return best;
  };

  for (const { sector, alts } of SECTOR_TOKENS) {
    for (const alt of alts) {
      const hit = tryAlt(alt);
      if (hit) {
        for (const k of hit) used.add(k);
        const x = hit.reduce((s, k) => s + cx(words[k]), 0) / hit.length;
        sectorColumns.push({ x, label: sector });
        break;
      }
    }
  }

  // Consumer-pairing fallback: if Staples was matched but Discretionary wasn't
  // (or vice versa), an unused "Consumer" word becomes the missing one.
  const has = (sec) => sectorColumns.some((c) => c.label === sec);
  const findUnusedConsumer = () => {
    for (let i = 0; i < words.length; i++) {
      if (used.has(i)) continue;
      if (/^Consumer/i.test(stripPunct(words[i].text))) return i;
    }
    return -1;
  };
  if (has('Consumer Staples') && !has('Consumer Discretionary')) {
    const k = findUnusedConsumer();
    if (k >= 0) {
      used.add(k);
      sectorColumns.push({ x: cx(words[k]), label: 'Consumer Discretionary' });
    }
  } else if (has('Consumer Discretionary') && !has('Consumer Staples')) {
    const k = findUnusedConsumer();
    if (k >= 0) {
      used.add(k);
      sectorColumns.push({ x: cx(words[k]), label: 'Consumer Staples' });
    }
  }

  return sectorColumns.sort((a, b) => a.x - b.x);
}

const stripPunct = (s) => s.replace(/^[=\-■▪|(\[]+/, '').replace(/[|)\]:.,]+$/, '').trim();

// Find a chart title by locating words on the same row matching all keywords.
// Returns the Y of the title row, or null.
function findTitleY(words, keywords) {
  const rows = groupByY(words, 10);
  for (const row of rows) {
    const text = row.map((w) => w.text).join(' ').toLowerCase();
    if (keywords.every((k) => text.includes(k.toLowerCase()))) {
      return row.reduce((s, w) => s + cy(w), 0) / row.length;
    }
  }
  return null;
}

// Find the next chart title (or page bottom) below `titleY`. Used to bound the
// vertical extent of the current chart so we don't spill into the next one.
function findNextChartBoundary(words, titleY) {
  const TITLE_RE = /(Surprise|Growth|Margin|EPS|Revenue|Earnings)/i;
  let candidates = words
    .filter((w) => cy(w) > titleY + 200 && cy(w) < titleY + 2000)
    .filter((w) => TITLE_RE.test(w.text));
  // Need ≥2 keyword hits clustered at the same Y to count as a title row.
  const rows = groupByY(candidates, 10);
  for (const row of rows) {
    const text = row.map((w) => w.text).join(' ');
    if (/(Earnings|Revenue|Net Profit) (Growth|Surprise|Margin)/i.test(text)) {
      return Math.min(...row.map(cy)) - 20;
    }
  }
  return Infinity;
}

// Group words into rows by Y proximity. Returns array of arrays.
function groupByY(words, tolerance = 12) {
  const sorted = [...words].sort((a, b) => cy(a) - cy(b));
  const rows = [];
  let current = [];
  let currentY = -Infinity;
  for (const w of sorted) {
    const y = cy(w);
    if (y - currentY > tolerance) {
      if (current.length) rows.push(current);
      current = [w];
      currentY = y;
    } else {
      current.push(w);
      currentY = (currentY * (current.length - 1) + y) / current.length;
    }
  }
  if (current.length) rows.push(current);
  return rows;
}

// Try to assemble a sector name from the leftmost 1–4 words of a row.
function matchLeftSectorLabel(rowSorted) {
  for (let n = Math.min(4, rowSorted.length); n >= 1; n--) {
    const candidate = rowSorted
      .slice(0, n)
      .map((w) => w.text.replace(/[|()[\]]/g, '').trim())
      .filter(Boolean)
      .join(' ');
    const sector = normSector(candidate);
    if (sector) return sector;
  }
  return null;
}

// ---- pdf rendering --------------------------------------------------------

async function renderPagePng(doc, pageNum, scale = 5) {
  const page = await doc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toBuffer('image/png');
}

// Walk the OCR result blocks → paragraphs → lines → words and return a flat array.
function flattenWords(data) {
  const out = [];
  for (const block of data.blocks ?? []) {
    for (const para of block.paragraphs ?? []) {
      for (const line of para.lines ?? []) {
        for (const w of line.words ?? []) {
          if (!w.text || !w.text.trim()) continue;
          out.push(w);
        }
      }
    }
  }
  return out;
}

// ---- top-level orchestrator ----------------------------------------------

export async function extractSectorCharts(pdfPath, { verbose = false } = {}) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(fs.readFileSync(pdfPath));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;

  const worker = await createWorker('eng');
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });

  // Cache OCR'd words per page so we render each page only once even when
  // multiple targets share a page or page-range.
  const wordsCache = new Map();
  const ocrPage = async (pageNum) => {
    if (wordsCache.has(pageNum)) return wordsCache.get(pageNum);
    if (pageNum < 1 || pageNum > doc.numPages) return null;
    if (verbose) console.error(`[charts] OCR page ${pageNum}...`);
    const png = await renderPagePng(doc, pageNum);
    const { data: ocr } = await worker.recognize(png, {}, { blocks: true });
    const words = mergeSplitNumbers(flattenWords(ocr));
    wordsCache.set(pageNum, words);
    return words;
  };

  const result = {};
  for (const t of CHART_TARGETS) {
    const handler =
      t.layout === 'horizontal' ? extractHorizontalBars :
      t.layout === 'verticalTable' ? extractVerticalTable :
      null;
    if (!handler) continue;

    const [first, last] = t.pageRange;
    let foundPage = null;
    let foundValues = {};
    for (let p = first; p <= last; p++) {
      const words = await ocrPage(p);
      if (!words) continue;
      // Quick title check: a chart with this title must be on this page.
      const titleY = findTitleY(words, t.titleKeywords);
      if (titleY == null) continue;
      const values = handler(words, { ...t, _debug: verbose });
      if (Object.keys(values).length > 0) {
        foundPage = p;
        foundValues = values;
        break;
      }
    }

    result[t.kind] = { page: foundPage, values: foundValues };
    if (verbose) {
      const filled = Object.keys(foundValues).length;
      console.error(`[charts]   ${t.kind}: ${filled}/${ALL_SECTORS.length} sectors${foundPage ? ` (page ${foundPage})` : ' (NOT FOUND)'}`);
    }
  }

  await worker.terminate();
  await doc.destroy();
  return result;
}
