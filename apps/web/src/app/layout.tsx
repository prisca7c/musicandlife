import type { Metadata } from 'next';
import { Lexend } from 'next/font/google';
import './globals.css';
import { ServerWakingBanner } from '@/components/server-waking-banner';

// Self-hosted + preloaded by Next at build time — no render-blocking request to
// fonts.googleapis.com on every page load (the previous CSS @import serialized
// three round-trips before first paint). `swap` avoids invisible text.
const lexend = Lexend({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-lexend',
});

export const metadata: Metadata = {
  title: 'Music & Life OS',
  description: 'Studio management system',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" className={lexend.variable}>
      <body className="antialiased">
        <ServerWakingBanner />
        {children}
      </body>
    </html>
  );
}
