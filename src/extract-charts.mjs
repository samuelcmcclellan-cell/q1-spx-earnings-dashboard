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
  { pageRange: [13, 18], kind: 'epsBeatPct',      layout: 'verticalTable', titleKeywords: ['Earnings', 'Below', 'Estimates'], valueBound: 100, currentRowKeywords: ['Above'] },
  { pageRange: [13, 18], kind: 'revBeatPct',      layout: 'verticalTable', titleKeywords: ['Revenues', 'Below', 'Estimates'], valueBound: 100, currentRowKeywords: ['Above'] },
  { pageRange: [14, 19], kind: 'epsSurprise',     layout: 'horizontal',    titleKeywords: ['Earnings', 'Surprise'], valueBound: 100 },
  { pageRange: [14, 19], kind: 'revSurprise',     layout: 'horizontal',    titleKeywords: ['Revenue', 'Surprise'],  valueBound: 10 },
  { pageRange: [18, 22], kind: 'earningsGrowth',  layout: 'verticalTable', titleKeywords: ['Earnings', 'Growth'],   valueBound: 100, currentRowKeywords: ['Today'] },
  { pageRange: [18, 22], kind: 'revenueGrowth',   layout: 'verticalTable', titleKeywords: ['Revenue', 'Growth'],    valueBound: 100, currentRowKeywords: ['Today'] },
  { pageRange: [20, 24], kind: 'netProfitMargin', layout: 'verticalTable', titleKeywords: ['S&P', 'Margins'],       valueBound: 60,  currentRowKeywords: ['Q126'] },
];

// ---- helpers --------------------------------------------------------------

const isNumericPct = (s) => /^-?\d+(\.\d+)?%$/.test(s);
const numericValue = (s) => parseFloat(s.replace(/%/g, ''));

// Tesseract sometimes confuses similar-looking glyphs in numeric strings:
// "T" for "7", "I"/"l" for "1", "O" for "0", "B" for "8", "Z" for "2".
// If a word ends in % and looks ALMOST numeric, attempt the substitutions and
// keep the result only when it parses cleanly. Conservative — leaves true
// non-numeric words ("S&P", "FACTSET") untouched because they don't end in %.
function coerceNumericPct(text) {
  if (isNumericPct(text)) return text;
  if (!text.endsWith('%')) return text;
  let fixed = text;
  for (const [from, to] of [['T', '7'], ['l', '1'], ['I', '1'], ['O', '0'], ['B', '8'], ['Z', '2']]) {
    fixed = fixed.split(from).join(to);
  }
  return isNumericPct(fixed) ? fixed : text;
}

// Distance under which a chart value is treated as the S&P 500 aggregate bar
// rather than a sector. 0.15 covers display-rounding artifacts (chart and
// aggregate are both shown to 1 decimal) while still admitting nearby sector
// values — Real Estate's 2.3% revenue surprise is comfortably outside the
// aggregate's 2.0%, for example.
const AGGREGATE_TOLERANCE = 0.15;

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
//
// Three passes:
//   1. Match each row by its left-side sector label.
//   2. For rows whose label OCR'd unrecognizably, fall back to value-based
//      cross-reference: if the row's value matches exactly one narrative
//      sector value (within ±0.15), assign to that sector.
//   3. For rows whose label matched but the value OCR'd as garble (e.g.
//      "BB", "REED" for small/negative bars), re-OCR the value cell at
//      higher resolution via `recovery.ocrRegion`.
//
// Values matching the S&P 500 aggregate (e.g. blended +12.3% surprise) are
// dropped — that's the index-level row, not a sector.
async function extractHorizontalBars(words, target, recovery, pageNum) {
  const titleY = findTitleY(words, target.titleKeywords);
  if (titleY == null) return {};

  const nextBoundary = findNextChartBoundary(words, titleY);
  const chartWords = words.filter((w) => cy(w) > titleY + 30 && cy(w) < nextBoundary);
  const rows = groupByY(chartWords, 12);

  const result = {};
  const usedSectors = new Set();
  const aggregate = target._aggregate;
  const unmatched = [];
  const labeledRowsMissingValue = []; // rows whose label matched but value didn't parse

  for (const row of rows) {
    const sorted = [...row].sort((a, b) => cx(a) - cx(b));
    const valueWord = [...sorted].reverse().find((w) => isNumericPct(w.text));
    const sector = matchLeftSectorLabel(sorted);
    // Detect the S&P 500 aggregate row by its label so we drop it without
    // relying on a value-tolerance match (which fires false positives when
    // a sector bar happens to equal the index value).
    const isAggregateRow = sorted.slice(0, 4).some((w) => /^(S&?P|500)$/i.test(stripPunct(w.text)));
    if (isAggregateRow) continue;

    if (!valueWord) {
      if (sector && !usedSectors.has(sector)) labeledRowsMissingValue.push({ sector, row: sorted });
      continue;
    }
    const v = correctValue(numericValue(valueWord.text), target.valueBound);
    if (v == null) {
      if (sector && !usedSectors.has(sector)) labeledRowsMissingValue.push({ sector, row: sorted });
      continue;
    }

    if (sector && !usedSectors.has(sector)) {
      // Trust the label match — don't apply the value-tolerance aggregate
      // filter here, since the label uniquely identifies the row as a sector
      // (e.g. Industrials revSurprise=2.0 happens to equal the index 2.0).
      result[sector] = v;
      usedSectors.add(sector);
    } else if (!sector) {
      // Without a label match, fall back to value-based aggregate filtering.
      if (aggregate != null && Math.abs(v - aggregate) < AGGREGATE_TOLERANCE) continue;
      unmatched.push(v);
    }
  }

  if (target._narrative) {
    for (const v of unmatched) {
      const matches = Object.entries(target._narrative)
        .filter(([s, nv]) => nv != null && !usedSectors.has(s) && Math.abs(nv - v) < 0.15);
      if (matches.length === 1) {
        result[matches[0][0]] = v;
        usedSectors.add(matches[0][0]);
      }
    }
  }

  // Recovery pass — re-OCR value cells for labeled rows whose value didn't
  // parse at scale 5. The bar chart values for small numbers tend to render
  // as 1–2 thin glyphs that scale-5 OCR mistakes for letter-shaped garble
  // ("BB", "REED"); rendering at 8x usually resolves them cleanly.
  if (recovery) {
    if (target._debug) {
      console.error(`[debug] ${target.kind}: labeledRowsMissingValue count=${labeledRowsMissingValue.length}`);
      for (const { sector, row } of labeledRowsMissingValue) {
        const yAvg = row.reduce((s, w) => s + cy(w), 0) / row.length;
        console.error(`[debug]   ${sector} yAvg=${yAvg.toFixed(0)}`);
      }
    }
    for (const { sector, row } of labeledRowsMissingValue) {
      if (result[sector] != null) continue;
      const yAvg = row.reduce((s, w) => s + cy(w), 0) / row.length;
      const v = await recoverHorizontalValue(recovery, pageNum, yAvg, target);
      if (target._debug) console.error(`[debug] recovery ${sector} y=${yAvg.toFixed(0)} → ${v}`);
      if (v == null) continue;
      // Label-matched rows bypass the aggregate-tolerance filter — see note
      // in the main loop. Trust the label.
      result[sector] = v;
      usedSectors.add(sector);
    }
  }

  return result;
}

// Recover a missing value for a horizontal-bar row by re-OCRing the right
// half of the row at higher resolution. The data column on FactSet's
// surprise charts spans roughly x=1500–1900 in scale-5 coords.
async function recoverHorizontalValue(recovery, pageNum, yCenter5, target) {
  // Snap to integer scale-5 coords so the scale-8 crop lands on a deterministic
  // pixel boundary. Sub-pixel offsets in yMin (from drawImage's float-source
  // sampling) shifted glyph rows enough to break OCR for tight numeric crops.
  const yc = Math.round(yCenter5);
  const { text } = await recovery.ocrRegion(pageNum, 1500, 1900, yc - 28, yc + 28, { numeric: true });
  return parseNumericFromText(text, target.valueBound);
}

// Pull the first plausible numeric percent out of a recovered text snippet.
// Tesseract sometimes wraps numbers in punctuation ("| 1.9%", "“82%") so we
// strip noise before parsing. Returns null if no number fits within bound.
function parseNumericFromText(text, valueBound) {
  if (!text) return null;
  const cleaned = text.replace(/[^\d.\-%]/g, ' ');
  const matches = cleaned.match(/-?\d+(?:\.\d+)?%?/g);
  if (!matches) return null;
  for (const tok of matches) {
    const fixed = coerceNumericPct(tok.endsWith('%') ? tok : tok + '%');
    if (!isNumericPct(fixed)) continue;
    const v = correctValue(numericValue(fixed), valueBound);
    if (v != null) return v;
  }
  return null;
}

// Vertical bar chart with data table: a current-period row of values aligned
// under a header row of sector names. Header row may span 2 visual rows (e.g.
// "Info." / "Technology" stacked). We anchor on the current row label,
// grab all numeric values on its row, then match each value's X to the
// closest sector header X.
async function extractVerticalTable(words, target, recovery, pageNum) {
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

  // 3. Find header row words ABOVE the anchor (within ~160px) that aren't axis labels.
  //    The header row contains sector names — possibly wrapped to 2 visual rows.
  //    Page 16's stacked-bar charts put two intermediate stack rows ("Below"
  //    and "In-Line") between the header and the "Above" anchor, pushing the
  //    upper header row to ~150px above; the wider window picks it up while
  //    page 20/22 still find their tighter headers within the same band.
  const headerCandidates = chartWords.filter(
    (w) => cy(w) < anchorY - 5 && cy(w) > anchorY - 160 && cx(w) > anchorX - 30,
  );

  // 4. Build sector "columns": cluster header words by X, then assemble the
  //    full label by combining stacked words (similar X across two rows).
  const sectorColumns = clusterHeaderIntoSectors(headerCandidates);
  if (target._debug) {
    console.error(`[debug] ${target.kind}: sectorColumns=${sectorColumns.length} ${sectorColumns.map((c) => `[${c.x.toFixed(0)}]"${c.label}"`).join(' ')}`);
  }

  // Identify the S&P 500 aggregate column by header label, so we can drop
  // values at that X without relying on value-tolerance matching (which
  // fires false positives when a sector value happens to equal the index).
  const aggregateColumnX = findAggregateColumnX(headerCandidates);
  if (target._debug && aggregateColumnX != null) {
    console.error(`[debug] ${target.kind}: aggregate column at x=${aggregateColumnX.toFixed(0)}`);
  }

  // 5. Match values to sectors. Two passes:
  //    Pass 1: each value → nearest sector column by X (within 90px).
  //    Pass 2: for values that didn't find a column, cross-reference with
  //            narrative-extracted values (assign to a sector whose narrative
  //            value uniquely matches this chart value within ±0.15).
  //    Values at the S&P 500 column X are dropped (it's the index bar).
  const result = {};
  const usedSectors = new Set();
  const consumedIdx = new Set();
  const aggregate = target._aggregate;
  const isAggregateValue = (val, v) => {
    // Prefer label-derived column position when we found one.
    if (aggregateColumnX != null) return Math.abs(cx(val) - aggregateColumnX) < 70;
    // Fallback: value-tolerance match when header didn't reveal the column.
    return aggregate != null && Math.abs(v - aggregate) < AGGREGATE_TOLERANCE;
  };

  for (let i = 0; i < rowValues.length; i++) {
    const val = rowValues[i];
    const v = correctValue(numericValue(val.text), target.valueBound);
    if (v == null) continue;
    if (isAggregateValue(val, v)) {
      consumedIdx.add(i);
      continue;
    }
    // Tesseract emits conf=0 when it found pixels but couldn't read them
    // confidently (e.g. truncated "76%" → "7%" on Industrials revBeatPct).
    // Don't trust these — fall through to the column-based recovery pass,
    // which re-OCRs the cell at scale 8.
    if ((val.confidence ?? 100) < 30) continue;

    let best = null;
    let bestDist = Infinity;
    for (const col of sectorColumns) {
      const d = Math.abs(col.x - cx(val));
      if (d < bestDist) { bestDist = d; best = col; }
    }
    if (!best || bestDist > 90) continue;
    if (usedSectors.has(best.label)) continue;
    result[best.label] = v;
    usedSectors.add(best.label);
    consumedIdx.add(i);
  }

  if (target._narrative) {
    for (let i = 0; i < rowValues.length; i++) {
      if (consumedIdx.has(i)) continue;
      const val = rowValues[i];
      const v = correctValue(numericValue(val.text), target.valueBound);
      if (v == null) continue;
      if (isAggregateValue(val, v)) continue;

      const matches = Object.entries(target._narrative)
        .filter(([s, nv]) => nv != null && !usedSectors.has(s) && Math.abs(nv - v) < 0.15);
      if (matches.length === 1) {
        result[matches[0][0]] = v;
        usedSectors.add(matches[0][0]);
        consumedIdx.add(i);
      }
    }
  }

  // Recovery pass — re-OCR garbled header columns at higher resolution.
  // When the chart has all 12 bars but two sectors share OCR-illegible
  // labels (e.g. Consumer Discretionary OCR'd as "Corer", Consumer Staples
  // as "oa"), the value at that column lands in `consumedIdx=false` because
  // no sectorColumn matches its X. Re-render the header strip above the
  // value at higher scale; the recovered text feeds matchTextToSector().
  if (recovery) {
    const ay = Math.round(anchorY);
    const headerYTop = ay - 160;
    const headerYBot = ay - 5;
    for (let i = 0; i < rowValues.length; i++) {
      if (consumedIdx.has(i)) continue;
      const val = rowValues[i];
      const lowConf = (val.confidence ?? 100) < 30;
      let v = correctValue(numericValue(val.text), target.valueBound);
      if (v == null && !lowConf) continue;
      if (v != null && isAggregateValue(val, v)) continue;

      const valX = Math.round(cx(val));
      const { text } = await recovery.ocrRegion(pageNum, valX - 110, valX + 110, headerYTop, headerYBot);
      const sector = matchTextToSector(text, usedSectors);
      if (sector) {
        // If the scale-5 value was unreliable (low conf, e.g. "7%" for what's
        // really 76%), re-OCR the value cell at the column X.
        if (lowConf) {
          const recovered = await recoverVerticalValue(recovery, pageNum, valX, anchorY, target);
          if (recovered != null) v = recovered;
        }
        if (v == null) continue;
        result[sector] = v;
        usedSectors.add(sector);
        consumedIdx.add(i);
        if (target._debug) console.error(`[debug] recovered ${sector} from header text "${text}" at x=${valX.toFixed(0)} value=${v}${lowConf ? ' (re-OCR)' : ''}`);
      }
    }

    // Recover values for sectors whose column was identified but whose
    // current-row cell OCR'd as garbage (e.g. "ooo" for Consumer Disc
    // netProfitMargin on page 22). Re-OCR the value cell.
    for (const col of sectorColumns) {
      if (usedSectors.has(col.label)) continue;
      const v = await recoverVerticalValue(recovery, pageNum, col.x, anchorY, target);
      if (v == null) continue;
      // Column was identified by sector label, so we trust it — skip the
      // aggregate filter (a sector value happening to equal the index value
      // shouldn't drop the cell).
      result[col.label] = v;
      usedSectors.add(col.label);
      if (target._debug) console.error(`[debug] recovered value ${v} for ${col.label} at x=${col.x.toFixed(0)}`);
    }

    // Gap-fill recovery — when both the header AND the value at a column
    // OCR'd as garbage at scale 5 (e.g. Consumer Discretionary on page 20:
    // header "oa", value missing). Detect missing X positions by analyzing
    // bar spacing, then re-OCR header + value at the inferred X.
    const knownX = [
      ...rowValues.filter((_, i) => consumedIdx.has(i)).map(cx),
      ...sectorColumns.map((c) => c.x),
      ...(aggregateColumnX != null ? [aggregateColumnX] : []),
    ].sort((a, b) => a - b);
    const dedupX = [];
    for (const x of knownX) {
      if (!dedupX.length || x - dedupX[dedupX.length - 1] > 30) dedupX.push(x);
    }
    if (dedupX.length >= 3) {
      const gaps = [];
      for (let i = 1; i < dedupX.length; i++) gaps.push(dedupX[i] - dedupX[i - 1]);
      const sortedGaps = [...gaps].sort((a, b) => a - b);
      const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
      for (let i = 1; i < dedupX.length; i++) {
        const span = dedupX[i] - dedupX[i - 1];
        if (span <= 1.5 * medianGap) continue;
        // Insert missing positions at integer multiples of medianGap.
        const count = Math.round(span / medianGap) - 1;
        for (let k = 1; k <= count; k++) {
          const missingX = Math.round(dedupX[i - 1] + (span * k) / (count + 1));
          if (aggregateColumnX != null && Math.abs(missingX - aggregateColumnX) < 70) continue;
          const { text: headerText } = await recovery.ocrRegion(
            pageNum, missingX - 110, missingX + 110, ay - 160, ay - 5,
          );
          const sector = matchTextToSector(headerText, usedSectors);
          if (!sector) {
            if (target._debug) console.error(`[debug] gap-fill miss: x=${missingX.toFixed(0)} headerText="${headerText}"`);
            continue;
          }
          const v = await recoverVerticalValue(recovery, pageNum, missingX, anchorY, target);
          if (v == null) {
            if (target._debug) console.error(`[debug] gap-fill ${sector} header ok but value null at x=${missingX.toFixed(0)}`);
            continue;
          }
          result[sector] = v;
          usedSectors.add(sector);
          if (target._debug) console.error(`[debug] gap-fill ${sector} = ${v} at x=${missingX.toFixed(0)} headerText="${headerText}"`);
        }
      }
    }
  }

  return result;
}

// Recover a value cell at known column X for vertical-table charts. Used
// when the column header was identified but the current-row cell OCR'd as
// garbage (FactSet's white-on-bar percent labels can fail at scale 5).
async function recoverVerticalValue(recovery, pageNum, colX5, anchorY5, target) {
  const cx5 = Math.round(colX5);
  const cy5 = Math.round(anchorY5);
  const { text } = await recovery.ocrRegion(pageNum, cx5 - 70, cx5 + 70, cy5 - 25, cy5 + 25, { numeric: true });
  return parseNumericFromText(text, target.valueBound);
}

// Locate the S&P 500 aggregate column's X by finding "S&P" / "500" in the
// header band. The two words are stacked or adjacent — average their X.
// Returns null if the chart didn't OCR the index label (rare).
function findAggregateColumnX(headerWords) {
  const sp = headerWords.filter((w) => /^S&?P$/i.test(stripPunct(w.text)));
  const fh = headerWords.filter((w) => /^500$/.test(stripPunct(w.text)));
  if (sp.length === 0 && fh.length === 0) return null;
  const all = [...sp, ...fh];
  return all.reduce((s, w) => s + cx(w), 0) / all.length;
}

// Match a recovered header text snippet against SECTOR_TOKENS and return
// the first sector whose pattern fits. Skips sectors already used. Used
// during the recovery pass when the scale-5 OCR garbled a column header.
function matchTextToSector(text, usedSectors) {
  const tokens = text.split(/[^\w&]+/).filter(Boolean);
  for (const { sector, alts } of SECTOR_TOKENS) {
    if (usedSectors.has(sector)) continue;
    for (const alt of alts) {
      if (alt.length === 1) {
        if (tokens.some((t) => alt[0].test(t))) return sector;
      } else {
        const i = tokens.findIndex((t) => alt[0].test(t));
        if (i < 0) continue;
        const j = tokens.findIndex((t, k) => k !== i && alt[1].test(t));
        if (j < 0) continue;
        return sector;
      }
    }
  }
  return null;
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

// Try to identify the sector for a horizontal-bar row from its leftmost words.
// Uses the same SECTOR_TOKENS alts as the vertical-table header parser, so
// labels OCR'd as "Cons." / "Tech" / garbled glyphs still resolve to a sector.
// A two-token alt requires both tokens within the leftmost 4 words.
function matchLeftSectorLabel(rowSorted) {
  const tokens = rowSorted.slice(0, 4).map((w) => stripPunct(w.text));
  for (const { sector, alts } of SECTOR_TOKENS) {
    for (const alt of alts) {
      if (alt.length === 1) {
        if (tokens.some((t) => alt[0].test(t))) return sector;
      } else {
        const i = tokens.findIndex((t) => alt[0].test(t));
        if (i < 0) continue;
        const j = tokens.findIndex((t, k) => k !== i && alt[1].test(t));
        if (j < 0) continue;
        return sector;
      }
    }
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
          // Coerce common OCR letter→digit confusions in percent-shaped strings
          // ("T.7%" → "7.7%"). Mutates only when the result is a clean numeric.
          const text = coerceNumericPct(w.text);
          out.push(text === w.text ? w : { ...w, text });
        }
      }
    }
  }
  return out;
}

// ---- top-level orchestrator ----------------------------------------------

// Top-level entry point.
//
// Optional context for OCR recovery:
//   `narrativeMatrix[kind][sector]` — values FactSet's prose attributes to a
//     sector. Used as a fallback when the chart label OCR'd badly: a chart
//     value matching exactly one narrative sector is assigned to that sector.
//   `blendedAggregates[kind]` — index-level value (S&P 500) for this metric.
//     Chart values within AGGREGATE_TOLERANCE of this are dropped (they're
//     the aggregate bar, not a sector).
export async function extractSectorCharts(
  pdfPath,
  { verbose = false, narrativeMatrix = null, blendedAggregates = null } = {},
) {
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

  // High-resolution render cache for region-OCR recovery. Pages are rendered
  // at scale 8 (~576 DPI) on demand and reused across all recovery calls
  // for that page. ~30MP per channel — heavier than the scale-5 render but
  // necessary to resolve the 1–2 glyph values on small bars.
  const hiResCache = new Map();
  const renderHighRes = async (pageNum, scale = 8) => {
    const key = `${pageNum}:${scale}`;
    if (hiResCache.has(key)) return hiResCache.get(key);
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(viewport.width, viewport.height);
    const ctx = canvas.getContext('2d');
    await page.render({ canvasContext: ctx, viewport }).promise;
    const entry = { canvas, scaleFactor: scale / 5 };
    hiResCache.set(key, entry);
    return entry;
  };

  // OCR a sub-region given in scale-5 coordinates. We try multiple PSM modes
  // and pick the highest-confidence non-empty result — region OCR fragments
  // are short (a single value cell or stacked-pair header), and PSM mode
  // matters: SPARSE_TEXT often returns empty on tight crops where SINGLE_LINE
  // succeeds, and vice versa for multi-token headers.
  const recoveryPsmModes = [PSM.SINGLE_LINE, PSM.SPARSE_TEXT, PSM.SINGLE_WORD];
  const ocrRegion = async (pageNum, x5Min, x5Max, y5Min, y5Max, opts = {}) => {
    const { scale = 8, numeric = false } = opts;
    const { canvas, scaleFactor } = await renderHighRes(pageNum, scale);
    const xMin = Math.max(0, x5Min * scaleFactor);
    const yMin = Math.max(0, y5Min * scaleFactor);
    const w = Math.round((x5Max - x5Min) * scaleFactor);
    const h = Math.round((y5Max - y5Min) * scaleFactor);
    if (w <= 0 || h <= 0) return { text: '', confidence: 0 };
    const crop = createCanvas(w, h);
    crop.getContext('2d').drawImage(canvas, xMin, yMin, w, h, 0, 0, w, h);
    const png = crop.toBuffer('image/png');
    // Numeric crops (value cells): restrict tesseract to digits/./%/- so it
    // doesn't decode small bars as "BB"/"REED" letter shapes. Headers leave
    // the whitelist empty so multi-word sector names parse normally.
    //
    // We use a fresh per-call worker for region OCR. The shared `worker` used
    // for full-page passes carries persistent internal state that, when we
    // toggle PSM/whitelist mid-session, sometimes returns empty/garbled text
    // for tight crops the standalone probe reads cleanly. Spinning a fresh
    // worker per region matches the probe's behavior and is fast for small
    // (<1MB) crops.
    let best = { text: '', confidence: 0 };
    const passes = numeric
      ? [
          { whitelist: '0123456789.%-', modes: recoveryPsmModes },
          { whitelist: '', modes: recoveryPsmModes },
        ]
      : [{ whitelist: '', modes: recoveryPsmModes }];
    for (const { whitelist, modes } of passes) {
      for (const mode of modes) {
        const w = await createWorker('eng');
        await w.setParameters({
          tessedit_pageseg_mode: mode,
          tessedit_char_whitelist: whitelist,
        });
        const { data: ocr } = await w.recognize(png);
        await w.terminate();
        const text = (ocr.text ?? '').replace(/\s+/g, ' ').trim();
        const conf = ocr.confidence ?? 0;
        if (process.env.OCR_REGION_DEBUG) console.error(`  ocrRegion PSM=${mode} wl=${whitelist ? 'num' : 'none'} conf=${conf} text="${text}"`);
        // For numeric crops, only accept text that contains a digit — letters
        // alone (from no-whitelist passes) are noise.
        if (numeric && !/\d/.test(text)) continue;
        if (text && (best.text === '' || conf > best.confidence)) {
          best = { text, confidence: conf };
        }
      }
    }
    return best;
  };

  const recovery = { ocrRegion, renderHighRes };

  const result = {};
  for (const t of CHART_TARGETS) {
    const handler =
      t.layout === 'horizontal' ? extractHorizontalBars :
      t.layout === 'verticalTable' ? extractVerticalTable :
      null;
    if (!handler) continue;

    const enriched = {
      ...t,
      _debug: verbose,
      _narrative: narrativeMatrix?.[t.kind] ?? null,
      _aggregate: blendedAggregates?.[t.kind] ?? null,
    };

    const [first, last] = t.pageRange;
    let foundPage = null;
    let foundValues = {};
    for (let p = first; p <= last; p++) {
      const words = await ocrPage(p);
      if (!words) continue;
      // Quick title check: a chart with this title must be on this page.
      const titleY = findTitleY(words, t.titleKeywords);
      if (titleY == null) continue;
      const values = await handler(words, enriched, recovery, p);
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
