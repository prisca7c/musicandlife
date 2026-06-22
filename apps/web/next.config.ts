import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@music-life/types', '@react-pdf/renderer'],
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
