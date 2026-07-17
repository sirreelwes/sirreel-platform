/** @type {import('next').NextConfig} */
const nextConfig = {
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
  },
};

module.exports = nextConfig;
