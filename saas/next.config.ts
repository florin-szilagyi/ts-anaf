import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The SDK is consumed from its built dist/ output (workspace-linked);
  // transpilePackages keeps dev mode working when dist is fresh from `pnpm build:sdk`.
  transpilePackages: ['@florinszilagyi/anaf-ts-sdk', '@florinszilagyi/fastbill-sdk'],
  eslint: {
    // Linting runs via the package `lint` script (repo-wide eslint config); the
    // Next build should not require an eslint setup of its own.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
