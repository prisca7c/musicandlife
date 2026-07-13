'use client';

import Link from 'next/link';

/**
 * The Terms page is opened from registration via target="_blank" (a new tab),
 * so "back" should simply close this tab and return the user to their
 * registration tab with all their entered information intact — NOT navigate to
 * a fresh /register page (which would drop everything). window.close() works
 * for tabs opened this way; if the page was opened directly (no opener / can't
 * close), we fall back to a normal link to /register.
 */
export default function BackToRegistration() {
  const handleBack = () => {
    // Attempt to close the tab. If it was opened from registration this
    // returns the user to their in-progress form.
    window.close();
  };

  return (
    <button
      type="button"
      onClick={handleBack}
      className="text-sm text-[var(--sage)] hover:underline bg-transparent border-0 cursor-pointer p-0"
    >
      ← Back to registration
    </button>
  );
}

/** Fallback link kept exported in case a plain navigation is ever needed. */
export function BackToRegistrationLink() {
  return (
    <Link href="/register" className="text-sm text-[var(--sage)] hover:underline">
      ← Back to registration
    </Link>
  );
}
