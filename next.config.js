/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' }, // Google avatars
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' }, // R2 storage
    ],
  },
};

module.exports = nextConfig;
