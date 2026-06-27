import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Music & Life OS',
  description: 'Studio management system',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="antialiased">{children}</body>
    </html>
  );
}
