const { LEGACY_REDIRECTS } = require('./src/lib/site/legacyRedirects.data.js')

/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Host canonicalization: www.sirreel.com → sirreel.com.
   *
   * Both hosts are in middleware's PUBLIC_HOSTS and both answered 200 for
   * every marketing path, so the whole public site existed at two origins —
   * the largest single source of duplicate content on the site, and one no
   * per-page canonical fully solves (a canonical is a hint; a 308 is not).
   *
   * PUBLIC_SITE_ORIGIN (src/lib/site/publicUrl.ts) already declares the apex
   * as canonical for metadataBase/sitemap/robots; this makes the server agree.
   *
   * Path and query are preserved: `:path*` carries the rest of the URL, and
   * Next re-appends the query string to the destination automatically.
   *
   * Then the legacy Wix map: all 113 paths from legacyRedirects.data.js, plus
   * the two prefix trees. Next evaluates redirects BEFORE middleware
   * (headers → redirects → middleware → rewrites, in
   * next/dist/server/lib/router-utils/resolve-routes.js), so these answer
   * without the marketing host's allow-list ever seeing the request.
   *
   * middleware.ts still resolves the same map. Not redundant: `source`
   * patterns here are case-sensitive and slash-exact, so the config rules
   * cover the canonical lowercase form and middleware catches the variants
   * (/SuperCubeTruck, /popvan/).
   */
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.sirreel.com' }],
        destination: 'https://sirreel.com/:path*',
        permanent: true,
      },

      // Every legacy Wix path → its mapped destination, 308 permanent.
      ...Object.entries(LEGACY_REDIRECTS).map(([source, destination]) => ({
        source,
        destination,
        permanent: true,
      })),

      // Wix's uploaded-document store. The tail is passed straight through to
      // the CDN origin Wix itself proxied, so all 42 client-facing files keep
      // resolving. See legacyRedirects.ts for the Wix-account dependency this
      // still carries.
      {
        source: '/_files/:tail*',
        destination: 'https://static.wixstatic.com/:tail*',
        permanent: true,
      },
      // 63 Wix store product pages → the supply order form that now sells them.
      {
        source: '/product-page/:tail*',
        destination: '/order/supplies',
        permanent: true,
      },
    ]
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' }, // Google avatars
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' }, // R2 storage
    ],
  },
  experimental: {
    // Loaded at runtime instead of bundled — webpack mangles pdfjs's
    // .mjs entry and @napi-rs/canvas's native binary, which is why the
    // contract-review annotation pre-pass silently failed in prod
    // (review fd97acb0: NULL manifest). Both are required by the
    // canonically-multimodal review pipeline.
    serverComponentsExternalPackages: ['pdfjs-dist', '@napi-rs/canvas'],
    // File-trace the pieces the externalized packages load DYNAMICALLY —
    // pdfjs's fake-worker setup imports pdf.worker.mjs at runtime, which
    // nft can't see, so the file was missing from the lambda
    // ("Cannot find module '/var/task/node_modules/pdfjs-dist/legacy/
    // build/pdf.worker.mjs'"). Same treatment for @napi-rs/canvas's
    // per-platform native binary. Keyed to every route that runs the
    // multimodal pre-pass.
    outputFileTracingIncludes: {
      '/api/tools/contract-review': [
        'node_modules/pdfjs-dist/legacy/build/**',
        'node_modules/@napi-rs/canvas/**',
        'node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      ],
      '/api/tools/contract-review/[id]/rerun': [
        'node_modules/pdfjs-dist/legacy/build/**',
        'node_modules/@napi-rs/canvas/**',
        'node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      ],
      '/api/portal/[token]/agreement/upload-redline': [
        'node_modules/pdfjs-dist/legacy/build/**',
        'node_modules/@napi-rs/canvas/**',
        'node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      ],
      '/api/portal/job/agreement/upload-redline': [
        'node_modules/pdfjs-dist/legacy/build/**',
        'node_modules/@napi-rs/canvas/**',
        'node_modules/@napi-rs/canvas-linux-x64-gnu/**',
      ],
    },
  },
};

module.exports = nextConfig;
