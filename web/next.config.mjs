import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export so Vercel serves it as plain files (no server runtime).
  output: 'export',
  // Trailing slash so paths like /sectors → /sectors/index.html resolve cleanly.
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Pin Turbopack root to this folder; the parent has its own package-lock.json
  // (for the CLI parser/builder) which would otherwise trigger a workspace warning.
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
