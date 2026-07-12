import type { Metadata } from 'next';
import './globals.css';
import { ServerWakingBanner } from '@/components/server-waking-banner';

export const metadata: Metadata = {
  title: 'Music & Life OS',
  description: 'Studio management system',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="antialiased">
        <ServerWakingBanner />
        {children}
      </body>
    </html>
  );
}
