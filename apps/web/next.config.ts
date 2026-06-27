import type { NextConfig } from 'next';
import path from 'path';

const config: NextConfig = {
  transpilePackages: ['@music-life/types', '@react-pdf/renderer'],
  // Without this, Next.js infers the monorepo root by scanning for the nearest
  // lockfile upward from this folder — which picks the wrong one if a stray
  // pnpm-lock.yaml exists higher up outside the project (e.g. in a home
  // directory), causing it to mis-trace and omit sibling workspace packages
  // (@music-life/db, @music-life/types) from the deployed serverless bundle.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  // Expose server-only vars to the Edge runtime (middleware + server components).
  // These are NOT bundled into client JS — only accessible server-side.
  serverRuntimeConfig: {
    jwtSecret: process.env.JWT_SECRET,
  },
  env: {
    JWT_SECRET: process.env.JWT_SECRET ?? '',
  },
};

export default config;
