import Link from 'next/link';
import Image from 'next/image';

// App-wide 404. Without this, Next.js serves its stark unstyled default ("404 —
// This page could not be found.") with no branding and, worse, no way back — a
// dead end for anyone who mistypes a URL or follows a stale link.
export default function NotFound() {
  return (
    <div className="auth-bg">
      <div className="auth-card text-center">
        <div className="flex justify-center mb-7">
          <Image src="/logo-full.png" alt="Music & Life London"
            width={280} height={120} className="w-[220px] h-auto object-contain" priority />
        </div>
        <p className="text-5xl font-extrabold tracking-tight" style={{ color: 'var(--sage-dk)' }}>404</p>
        <h1 className="text-[22px] font-extrabold tracking-tight mt-3" style={{ color: 'var(--txt)' }}>
          We couldn&apos;t find that page
        </h1>
        <p className="text-sm mt-2 mb-7" style={{ color: 'var(--txt3)' }}>
          The link may be old or mistyped. Let&apos;s get you back to your portal.
        </p>
        <div className="flex flex-col gap-2">
          <Link href="/login"
            className="w-full rounded-xl bg-[var(--sage)] text-white text-sm font-semibold py-2.5 hover:bg-[var(--sage-dk)] transition">
            Back to sign in
          </Link>
          <Link href="/register" className="text-sm font-semibold" style={{ color: 'var(--sage-dk)' }}>
            New here? Register &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
