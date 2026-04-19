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
  experimental: {
    serverComponentsExternalPackages: [
      "playwright-core",
      "@sparticuz/chromium",
    ],
  },
};

module.exports = nextConfig;
