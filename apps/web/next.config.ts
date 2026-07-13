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
  // Baseline security headers on every response. These close clickjacking
  // (X-Frame-Options + CSP frame-ancestors), MIME-sniffing, referrer leakage,
  // and lock down powerful browser features the app doesn't use. A full
  // resource-CSP (script/connect/img-src) is intentionally deferred — it must
  // be validated against the live API origin (NEXT_PUBLIC_API_URL) and R2 URLs
  // first, or it silently breaks API calls and image loads.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default config;
