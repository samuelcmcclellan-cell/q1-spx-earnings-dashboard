// build-dashboard.mjs — render a parsed FactSet JSON into Q1_2026_Earnings_Dashboard.xlsx.
//
// Produces 9 sheets per the approved plan. Style decisions enforce the project's
// "objectivity" rules:
//   - No narrative titles ("Sector Matrix", not "Growth Engines").
//   - All 11 sectors shown in every sector table — no winners/losers panels.
//   - No red/green; use a single blue data-bar conditional format on numeric columns.
//   - Historical context (1yr/5yr/10yr averages) shown adjacent to current values.
//   - Each sheet header cites source PDF, FactSet as-of date, and parsed-on date.
//   - Cell labels match FactSet's own labels — no interpretive prose.

import ExcelJS from 'exceljs';

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

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const SUBHEAD_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };
const SUBHEAD_FONT = { bold: true };
const META_FONT = { italic: true, color: { argb: 'FF595959' }, size: 9 };
const BORDER_THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const ALL_BORDERS = { top: BORDER_THIN, left: BORDER_THIN, bottom: BORDER_THIN, right: BORDER_THIN };

// ---- helpers --------------------------------------------------------------

function applyHeader(sheet, data, sheetTitle, pageCitation) {
  // Row 1: sheet title (purely descriptive — matches FactSet terminology)
  const r1 = sheet.addRow([sheetTitle]);
  r1.font = { bold: true, size: 14 };
  sheet.mergeCells(`A${r1.number}:H${r1.number}`);

  // Row 2: meta line
  const meta =
    `Source: ${data.meta.sourcePdf}` +
    `   |   FactSet as-of: ${data.meta.asOfDate ?? '—'}` +
    `   |   Quarter: ${data.meta.quarter ?? '—'}` +
    `   |   Parsed: ${data.meta.parsedAt.slice(0, 10)}` +
    (pageCitation ? `   |   Source pages: ${pageCitation}` : '');
  const r2 = sheet.addRow([meta]);
  r2.font = META_FONT;
  sheet.mergeCells(`A${r2.number}:H${r2.number}`);

  sheet.addRow([]); // spacer
}

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { horizontal: 'left', vertical: 'middle' };
    cell.border = ALL_BORDERS;
  });
}

function styleSubheadRow(row) {
  row.eachCell((cell) => {
    cell.fill = SUBHEAD_FILL;
    cell.font = SUBHEAD_FONT;
    cell.border = ALL_BORDERS;
  });
}

function styleDataRow(row) {
  row.eachCell((cell) => {
    cell.border = ALL_BORDERS;
  });
}

function setColumnWidths(sheet, widths) {
  widths.forEach((w, i) => {
    sheet.getColumn(i + 1).width = w;
  });
}

// Add a blue data-bar conditional format to a numeric column range.
// `colLetter`: 'B', 'C', etc. `firstRow`/`lastRow`: 1-indexed row range.
function addDataBar(sheet, colLetter, firstRow, lastRow) {
  if (lastRow < firstRow) return;
  sheet.addConditionalFormatting({
    ref: `${colLetter}${firstRow}:${colLetter}${lastRow}`,
    rules: [
      {
        type: 'dataBar',
        priority: 1,
        cfvo: [{ type: 'min' }, { type: 'max' }],
        color: { argb: 'FF5B9BD5' },
        gradient: false,
        showValue: true,
      },
    ],
  });
}

// Emit a value-or-em-dash; preserves nulls as the literal "—" so missing data
// is visible in the workbook and not silently zeroed.
const v = (x) => (x === null || x === undefined ? '—' : x);

// ---- sheet builders -------------------------------------------------------

function buildSummary(wb, data) {
  const sheet = wb.addWorksheet('Summary');
  applyHeader(sheet, data, 'Summary — FactSet Key Metrics', '1');
  setColumnWidths(sheet, [40, 15, 15, 15, 15]);

  const headerRow = sheet.addRow(['Metric', 'Current', '1-yr avg', '5-yr avg', '10-yr avg']);
  styleHeaderRow(headerRow);

  const km = data.keyMetrics;
  const sc = data.scorecard;
  const npm = data.netProfitMargin;
  const rows = [
    ['% of S&P 500 reporting actual results', km.pctReported, null, null, null],
    ['% reporting EPS above estimate', sc.epsBeat.current, sc.epsBeat.avg1yr, sc.epsBeat.avg5yr, sc.epsBeat.avg10yr],
    ['EPS surprise %', sc.epsSurprise.current, sc.epsSurprise.avg1yr, sc.epsSurprise.avg5yr, sc.epsSurprise.avg10yr],
    ['% reporting revenue above estimate', sc.revenueBeat.current, sc.revenueBeat.avg1yr, sc.revenueBeat.avg5yr, sc.revenueBeat.avg10yr],
    ['Revenue surprise %', sc.revenueSurprise.current, sc.revenueSurprise.avg1yr, sc.revenueSurprise.avg5yr, sc.revenueSurprise.avg10yr],
    ['Blended (year-over-year) earnings growth %', km.blendedEarningsGrowth, null, null, null],
    ['Blended (year-over-year) revenue growth %', km.blendedRevenueGrowth, null, null, null],
    ['Blended net profit margin %', npm.current, null, npm.avg5yr, null],
    ['# companies issuing negative EPS guidance', km.negativeGuidanceCount, null, null, null],
    ['# companies issuing positive EPS guidance', km.positiveGuidanceCount, null, null, null],
    ['Forward 12M P/E ratio', km.fwdPe, null, km.fwdPe5yr, km.fwdPe10yr],
  ];
  for (const r of rows) {
    const row = sheet.addRow(r.map(v));
    styleDataRow(row);
  }

  // Net profit margin context block (previous-quarter and year-ago).
  sheet.addRow([]);
  const subhead = sheet.addRow(['Net profit margin — additional context']);
  styleSubheadRow(subhead);
  sheet.mergeCells(`A${subhead.number}:E${subhead.number}`);
  styleDataRow(sheet.addRow(['Previous quarter net profit margin %', v(npm.previousQuarter), '', '', '']));
  styleDataRow(sheet.addRow(['Year-ago net profit margin %', v(npm.yearAgo), '', '', '']));
}

function buildSectorMatrix(wb, data) {
  const sheet = wb.addWorksheet('Sector Matrix');
  applyHeader(sheet, data, 'Sector Matrix — All 11 GICS Sectors', '4–7, 14–15, 22–23');
  setColumnWidths(sheet, [25, 13, 13, 13, 13, 16, 16, 14, 14, 14]);

  const headerRow = sheet.addRow([
    'Sector',
    '% beat EPS',
    '% beat revenue',
    'EPS surprise %',
    'Revenue surprise %',
    'Earnings growth %',
    'Revenue growth %',
    'Net profit margin %',
    'Net profit margin (5-yr avg)',
    'Net profit margin (year ago)',
  ]);
  styleHeaderRow(headerRow);

  const firstDataRow = sheet.lastRow.number + 1;
  for (const s of data.sectorMatrix) {
    const row = sheet.addRow([
      s.sector,
      v(s.epsBeatPct),
      v(s.revBeatPct),
      v(s.epsSurprise),
      v(s.revSurprise),
      v(s.earningsGrowth),
      v(s.revenueGrowth),
      v(s.netProfitMargin),
      v(s.netProfitMargin5yr),
      v(s.netProfitMarginYearAgo),
    ]);
    styleDataRow(row);
  }
  const lastDataRow = sheet.lastRow.number;

  // Apply data bars to every numeric column (B through J).
  ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].forEach((col) => {
    addDataBar(sheet, col, firstDataRow, lastDataRow);
  });

  sheet.autoFilter = {
    from: { row: firstDataRow - 1, column: 1 },
    to: { row: lastDataRow, column: 10 },
  };
}

function buildSectorDetail(wb, data) {
  const sheet = wb.addWorksheet('Sector Detail');
  applyHeader(sheet, data, 'Sector Detail — Industry-Level Earnings & Revenue Growth', '4, 6');
  setColumnWidths(sheet, [25, 45, 18, 14]);

  const headerRow = sheet.addRow(['Sector', 'Industry', 'Metric', 'Growth %']);
  styleHeaderRow(headerRow);

  const firstDataRow = sheet.lastRow.number + 1;
  for (const sector of SECTORS) {
    const detail = data.sectorIndustries[sector];
    if (!detail) {
      const row = sheet.addRow([sector, '(no industry breakdown reported)', '—', '—']);
      styleDataRow(row);
      continue;
    }
    for (const item of detail.earnings || []) {
      const row = sheet.addRow([sector, item.industry, 'Earnings growth', v(item.growth)]);
      styleDataRow(row);
    }
    for (const item of detail.revenue || []) {
      const row = sheet.addRow([sector, item.industry, 'Revenue growth', v(item.growth)]);
      styleDataRow(row);
    }
  }
  const lastDataRow = sheet.lastRow.number;
  addDataBar(sheet, 'D', firstDataRow, lastDataRow);
  sheet.autoFilter = {
    from: { row: firstDataRow - 1, column: 1 },
    to: { row: lastDataRow, column: 4 },
  };
}

function buildCompanyContributors(wb, data) {
  const sheet = wb.addWorksheet('Company Contributors');
  applyHeader(sheet, data, 'Company Contributors — FactSet-Cited Companies and Ex-Contributor Sensitivity', '4, 11–13');
  setColumnWidths(sheet, [25, 30, 14, 14, 50]);

  const headerRow = sheet.addRow(['Sector', 'Company / Industry', 'Actual EPS', 'Estimate EPS', 'Ex-contributor sensitivity (full → ex)']);
  styleHeaderRow(headerRow);

  for (const sector of SECTORS) {
    const c = data.companyContributors[sector];
    if (!c) {
      const row = sheet.addRow([sector, '(no specific contributor cited)', '—', '—', '—']);
      styleDataRow(row);
      continue;
    }
    const sens = c.exContributor
      ? `Full sector growth: ${v(c.exContributor.fullGrowth)}% → Ex-contributor: ${v(c.exContributor.adjustedGrowth)}%`
      : '—';
    if (c.companies && c.companies.length > 0) {
      c.companies.forEach((comp, i) => {
        const row = sheet.addRow([
          sector,
          comp.company,
          v(comp.actual),
          v(comp.estimate),
          i === 0 ? sens : '',
        ]);
        styleDataRow(row);
      });
    } else {
      const row = sheet.addRow([sector, '(industry-level contributor only)', '—', '—', sens]);
      styleDataRow(row);
    }
  }
}

function buildRevisions(wb, data) {
  const sheet = wb.addWorksheet('Revisions');
  applyHeader(sheet, data, 'Earnings & Revenue Growth Revisions', '8–10');
  setColumnWidths(sheet, [40, 13, 13, 18]);

  // Index-level revisions
  const r1 = sheet.addRow(['Index-level growth-rate revisions']);
  styleSubheadRow(r1);
  sheet.mergeCells(`A${r1.number}:D${r1.number}`);

  const headerRow = sheet.addRow(['Metric', 'Current', '1 week ago', 'End of quarter (Mar 31)']);
  styleHeaderRow(headerRow);

  const e = data.revisions.earningsGrowth;
  const rv = data.revisions.revenueGrowth;
  styleDataRow(sheet.addRow(['Blended earnings growth %', v(e.current), v(e.lastWeek), v(e.endOfQuarter)]));
  styleDataRow(sheet.addRow(['Blended revenue growth %', v(rv.current), v(rv.lastWeek), v(rv.endOfQuarter)]));

  sheet.addRow([]);

  // Per-sector revisions since end of quarter
  const r2 = sheet.addRow(['Per-sector earnings growth: current vs end of quarter (Mar 31)']);
  styleSubheadRow(r2);
  sheet.mergeCells(`A${r2.number}:D${r2.number}`);

  const headerRow2 = sheet.addRow(['Sector', 'Current %', 'End of quarter %', 'Change (pp)']);
  styleHeaderRow(headerRow2);

  // Build a map for quick lookup
  const map = new Map(data.revisions.sectorSinceQuarterEnd.map((s) => [s.sector, s]));
  const firstRow = sheet.lastRow.number + 1;
  for (const sector of SECTORS) {
    const rec = map.get(sector);
    if (rec) {
      const change = rec.current !== null && rec.endOfQuarter !== null ? rec.current - rec.endOfQuarter : null;
      const changeRounded = change === null ? null : Math.round(change * 10) / 10;
      styleDataRow(sheet.addRow([sector, v(rec.current), v(rec.endOfQuarter), v(changeRounded)]));
    } else {
      styleDataRow(sheet.addRow([sector, '—', '—', '—']));
    }
  }
  const lastRow = sheet.lastRow.number;
  addDataBar(sheet, 'B', firstRow, lastRow);
  addDataBar(sheet, 'C', firstRow, lastRow);
  addDataBar(sheet, 'D', firstRow, lastRow);
}

function buildMarketReaction(wb, data) {
  const sheet = wb.addWorksheet('Market Reaction');
  applyHeader(sheet, data, 'Market Reaction — Avg Price Move (2-day pre to 2-day post)', '12–13');
  setColumnWidths(sheet, [40, 18, 18]);

  const headerRow = sheet.addRow(['Surprise type', 'Current %', '5-year average %']);
  styleHeaderRow(headerRow);

  const mr = data.marketReaction;
  styleDataRow(sheet.addRow(['Positive earnings surprises', v(mr.positiveSurprise.current), v(mr.positiveSurprise.avg5yr)]));
  styleDataRow(sheet.addRow(['Negative earnings surprises', v(mr.negativeSurprise.current), v(mr.negativeSurprise.avg5yr)]));
}

function buildForwardEstimatesGuidance(wb, data) {
  const sheet = wb.addWorksheet('Forward & Guidance');
  applyHeader(sheet, data, 'Forward Estimates & EPS Guidance', '17–21');
  setColumnWidths(sheet, [16, 18, 18, 22]);

  // Forward estimates table
  const r1 = sheet.addRow(['Forward growth & margin estimates']);
  styleSubheadRow(r1);
  sheet.mergeCells(`A${r1.number}:D${r1.number}`);

  const headerRow = sheet.addRow(['Period', 'Earnings growth %', 'Revenue growth %', 'Net profit margin %']);
  styleHeaderRow(headerRow);

  const periods = ['Q2_2026', 'Q3_2026', 'Q4_2026', 'CY_2026', 'CY_2027'];
  for (const p of periods) {
    const e = data.forwardEstimates[p] || {};
    styleDataRow(sheet.addRow([p.replace('_', ' '), v(e.earningsGrowth), v(e.revenueGrowth), v(e.netProfitMargin)]));
  }

  sheet.addRow([]);

  // Guidance — next quarter
  const r2 = sheet.addRow(['Next-quarter EPS guidance']);
  styleSubheadRow(r2);
  sheet.mergeCells(`A${r2.number}:D${r2.number}`);

  const guidanceHeader = sheet.addRow(['Metric', 'Count / %', '5-yr avg %', '10-yr avg %']);
  styleHeaderRow(guidanceHeader);

  const nq = data.guidance.nextQuarter;
  if (nq) {
    styleDataRow(sheet.addRow([`Companies issuing ${nq.label} guidance`, v(nq.total), '—', '—']));
    styleDataRow(sheet.addRow(['Negative guidance count', v(nq.negative), '—', '—']));
    styleDataRow(sheet.addRow(['Positive guidance count', v(nq.positive), '—', '—']));
    styleDataRow(sheet.addRow(['% of total that are negative', v(nq.negPct), v(nq.negPct5yr), v(nq.negPct10yr)]));
  } else {
    styleDataRow(sheet.addRow(['(no next-quarter guidance summary parsed)', '—', '—', '—']));
  }

  sheet.addRow([]);

  // Guidance — full year
  const r3 = sheet.addRow(['Full-year EPS guidance']);
  styleSubheadRow(r3);
  sheet.mergeCells(`A${r3.number}:D${r3.number}`);

  const fyHeader = sheet.addRow(['Metric', 'Value', '', '']);
  styleHeaderRow(fyHeader);

  const fy = data.guidance.fullYear;
  if (fy) {
    styleDataRow(sheet.addRow(['Companies issuing FY guidance', v(fy.total), '', '']));
    styleDataRow(sheet.addRow(['Negative guidance count', v(fy.negative), '', '']));
    styleDataRow(sheet.addRow(['Positive guidance count', v(fy.positive), '', '']));
    styleDataRow(sheet.addRow(['% of total that are negative', v(fy.negPct), '', '']));
  } else {
    styleDataRow(sheet.addRow(['(no full-year guidance summary parsed)', '—', '', '']));
  }
}

function buildValuationTargets(wb, data) {
  const sheet = wb.addWorksheet('Valuation & Targets');
  applyHeader(sheet, data, 'Valuation, Price Targets, and Ratings', '24–30');
  setColumnWidths(sheet, [30, 14, 14, 14, 18]);

  // Valuation
  const r1 = sheet.addRow(['Index-level valuation']);
  styleSubheadRow(r1);
  sheet.mergeCells(`A${r1.number}:E${r1.number}`);

  const headerRow = sheet.addRow(['Metric', 'Current', '5-yr avg', '10-yr avg', 'End of quarter']);
  styleHeaderRow(headerRow);

  const fp = data.valuation.fwdPe;
  const tp = data.valuation.trailingPe;
  styleDataRow(sheet.addRow(['Forward 12M P/E', v(fp.current), v(fp.avg5yr), v(fp.avg10yr), v(fp.endOfQuarter)]));
  styleDataRow(sheet.addRow(['Trailing 12M P/E', v(tp.current), v(tp.avg5yr), v(tp.avg10yr), '—']));

  sheet.addRow([]);

  // Sector P/E
  const r2 = sheet.addRow(['Sector forward 12M P/E (where reported)']);
  styleSubheadRow(r2);
  sheet.mergeCells(`A${r2.number}:E${r2.number}`);
  const peHeader = sheet.addRow(['Sector', 'Forward P/E', '', '', '']);
  styleHeaderRow(peHeader);

  const peMap = new Map(data.valuation.sectorFwdPe.map((s) => [s.sector, s.fwdPe]));
  const firstPeRow = sheet.lastRow.number + 1;
  for (const sector of SECTORS) {
    const pe = peMap.get(sector);
    styleDataRow(sheet.addRow([sector, v(pe ?? null), '', '', '']));
  }
  const lastPeRow = sheet.lastRow.number;
  addDataBar(sheet, 'B', firstPeRow, lastPeRow);

  sheet.addRow([]);

  // Targets
  const r3 = sheet.addRow(['Bottom-up price target']);
  styleSubheadRow(r3);
  sheet.mergeCells(`A${r3.number}:E${r3.number}`);

  const tgt = data.targets;
  styleDataRow(sheet.addRow(['Bottom-up target price', v(tgt.bottomUpTarget), '', '', '']));
  styleDataRow(sheet.addRow(['Closing price', v(tgt.currentPrice), '', '', '']));
  styleDataRow(sheet.addRow(['Implied upside %', v(tgt.upsidePct), '', '', '']));

  sheet.addRow([]);

  // Sector upside
  const r4 = sheet.addRow(['Sector implied upside (where reported)']);
  styleSubheadRow(r4);
  sheet.mergeCells(`A${r4.number}:E${r4.number}`);
  const upHeader = sheet.addRow(['Sector', 'Implied upside %', '', '', '']);
  styleHeaderRow(upHeader);

  const upMap = new Map(tgt.sectorUpside.map((s) => [s.sector, s.upsidePct]));
  const firstUpRow = sheet.lastRow.number + 1;
  for (const sector of SECTORS) {
    const u = upMap.get(sector);
    styleDataRow(sheet.addRow([sector, v(u ?? null), '', '', '']));
  }
  const lastUpRow = sheet.lastRow.number;
  addDataBar(sheet, 'B', firstUpRow, lastUpRow);

  sheet.addRow([]);

  // Ratings
  const r5 = sheet.addRow(['Analyst ratings distribution']);
  styleSubheadRow(r5);
  sheet.mergeCells(`A${r5.number}:E${r5.number}`);
  const rateHeader = sheet.addRow(['Metric', 'Value', '', '', '']);
  styleHeaderRow(rateHeader);

  const r = data.ratings;
  styleDataRow(sheet.addRow(['Total ratings', v(r.totalRatings), '', '', '']));
  styleDataRow(sheet.addRow(['% Buy ratings', v(r.buyPct), '', '', '']));
  styleDataRow(sheet.addRow(['% Hold ratings', v(r.holdPct), '', '', '']));
  styleDataRow(sheet.addRow(['% Sell ratings', v(r.sellPct), '', '', '']));

  sheet.addRow([]);

  // Sector buy %
  const r6 = sheet.addRow(['Sector % Buy ratings (where reported)']);
  styleSubheadRow(r6);
  sheet.mergeCells(`A${r6.number}:E${r6.number}`);
  const buyHeader = sheet.addRow(['Sector', '% Buy', '', '', '']);
  styleHeaderRow(buyHeader);

  const buyMap = new Map(r.sectorBuyPct.map((s) => [s.sector, s.buyPct]));
  const firstBuyRow = sheet.lastRow.number + 1;
  for (const sector of SECTORS) {
    const b = buyMap.get(sector);
    styleDataRow(sheet.addRow([sector, v(b ?? null), '', '', '']));
  }
  const lastBuyRow = sheet.lastRow.number;
  addDataBar(sheet, 'B', firstBuyRow, lastBuyRow);
}

// "Raw Data" sheet: a flat key-value listing of every parsed value, so the
// reader can audit any number on any sheet back to its parsed origin.
function buildRawData(wb, data) {
  const sheet = wb.addWorksheet('Raw Data');
  applyHeader(sheet, data, 'Raw Data — Every Parsed Value', 'all');
  setColumnWidths(sheet, [50, 50, 25]);

  const headerRow = sheet.addRow(['Path', 'Value', 'Type']);
  styleHeaderRow(headerRow);

  const flatten = (obj, prefix = '') => {
    const out = [];
    if (obj === null || obj === undefined) {
      out.push([prefix || '(root)', '—', 'null']);
      return out;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, i) => {
        out.push(...flatten(item, `${prefix}[${i}]`));
      });
      return out;
    }
    if (typeof obj === 'object') {
      for (const [k, val] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${k}` : k;
        if (val !== null && typeof val === 'object') {
          out.push(...flatten(val, path));
        } else {
          out.push([path, val === null ? '—' : val, typeof val]);
        }
      }
      return out;
    }
    out.push([prefix || '(value)', obj, typeof obj]);
    return out;
  };

  for (const [path, val, type] of flatten(data)) {
    styleDataRow(sheet.addRow([path, val, type]));
  }
}

// ---- entry ---------------------------------------------------------------

export async function buildDashboard(data, outputPath) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Q1 SPX Earnings Factset Dashboard';
  wb.created = new Date();

  buildSummary(wb, data);
  buildSectorMatrix(wb, data);
  buildSectorDetail(wb, data);
  buildCompanyContributors(wb, data);
  buildRevisions(wb, data);
  buildMarketReaction(wb, data);
  buildForwardEstimatesGuidance(wb, data);
  buildValuationTargets(wb, data);
  buildRawData(wb, data);

  await wb.xlsx.writeFile(outputPath);
}
