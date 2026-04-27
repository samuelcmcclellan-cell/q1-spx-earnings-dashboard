// update.mjs — CLI entry point.
//
//   node src/update.mjs <path-to-EarningsInsight_MMDDYY.pdf>
//
// 1. Parses the FactSet PDF into a structured JSON.
// 2. Writes the JSON to data/parsed-<MMDDYY>.json (audit trail across weeks).
// 3. Builds output/Q1_2026_Earnings_Dashboard.xlsx from the JSON (overwrites).

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parseFactsetPdf } from './parse-factset.mjs';
import { buildDashboard } from './build-dashboard.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) {
    console.error('Usage: node src/update.mjs <path-to-FactSet-EarningsInsight.pdf>');
    process.exit(1);
  }

  const absPdfPath = resolve(pdfPath);
  if (!existsSync(absPdfPath)) {
    console.error(`File not found: ${absPdfPath}`);
    process.exit(1);
  }

  console.log(`Parsing ${basename(absPdfPath)}...`);
  const data = await parseFactsetPdf(absPdfPath);
  console.log(`  As-of date: ${data.meta.asOfDate}`);
  console.log(`  Quarter:    ${data.meta.quarter}`);
  console.log(`  % reported: ${data.keyMetrics.pctReported}%`);
  console.log(`  Blended earnings growth: ${data.keyMetrics.blendedEarningsGrowth}%`);

  // Tag JSON file by the source PDF date suffix (MMDDYY) when present
  const dateMatch = basename(absPdfPath).match(/(\d{6})/);
  const tag = dateMatch ? dateMatch[1] : new Date().toISOString().slice(0, 10);
  const dataDir = resolve(projectRoot, 'data');
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const jsonPath = resolve(dataDir, `parsed-${tag}.json`);
  writeFileSync(jsonPath, JSON.stringify(data, null, 2));
  console.log(`Wrote ${jsonPath}`);

  const outDir = resolve(projectRoot, 'output');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const xlsxPath = resolve(outDir, 'Q1_2026_Earnings_Dashboard.xlsx');
  await buildDashboard(data, xlsxPath);
  console.log(`Wrote ${xlsxPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
