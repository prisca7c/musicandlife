'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

export function BackButton({ label, fallbackHref }: { label: string; fallbackHref: string }) {
  const router = useRouter();

  function handleClick() {
    if (window.history.length > 1) router.back();
    else router.push(fallbackHref);
  }

  return (
    <button type="button" onClick={handleClick} className="ui-back-btn">
      <ArrowLeft size={14} /> {label}
    </button>
  );
}
