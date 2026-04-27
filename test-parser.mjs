// Quick smoke test for the parser. Not part of the build pipeline.
import { parseFactsetPdf } from './src/parse-factset.mjs';

const path = process.argv[2] || 'C:/Users/samue/Downloads/EarningsInsight_042426.pdf';
const data = await parseFactsetPdf(path);
console.log(JSON.stringify(data, null, 2));
