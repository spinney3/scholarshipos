/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // playwright-core and @sparticuz/chromium are used by the scraper at
  // runtime inside server routes (/api/scrape/*). They are NOT safe to
  // trace-bundle with webpack: playwright has optional imports for
  // chromium-bidi and electron that webpack tries to resolve and fails on,
  // and @sparticuz/chromium ships a binary that must stay on disk, not be
  // bundled. Marking them external tells Next to require() them at runtime
  // from node_modules instead of bundling.
  //
  // pdf-parse is used by /api/scholarships/import for PDF text extraction.
  // Its index.js runs a self-test against a bundled sample PDF at module-
  // load time, which webpack can't resolve in the Next serverless trace.
  // The route imports the deep path `pdf-parse/lib/pdf-parse.js` to skip
  // the self-test; externalizing here also keeps webpack from trying to
  // bundle its pdfjs-dist dependency.
  experimental: {
    serverComponentsExternalPackages: [
      "playwright-core",
      "@sparticuz/chromium",
      "pdf-parse",
    ],
  },
};

module.exports = nextConfig;
