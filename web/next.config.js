/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output bundles only what's needed to run — enables slim Docker images.
  output: 'standalone',
};

module.exports = nextConfig;
