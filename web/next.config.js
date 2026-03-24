/** @type {import('next').NextConfig} */
const enableStandaloneOutput =
  process.env.NEXT_OUTPUT_STANDALONE === '1' || process.platform !== 'win32';

const nextConfig = {
  reactStrictMode: true,
  // Standalone output bundles only what's needed to run for slim container images.
  ...(enableStandaloneOutput ? { output: 'standalone' } : {}),
};

module.exports = nextConfig;
