'use client';

import { Info } from 'lucide-react';
import { useState, useRef } from 'react';

/**
 * A small circle-i icon that reveals a plain-language explanation on hover,
 * focus, or tap. Use it next to anything a parent/student might find confusing.
 *
 *   <InfoTooltip text="We only offer times the teacher is actually free." />
 */
export function InfoTooltip({
  text,
  label = 'More information',
  size = 14,
}: {
  text: string;
  label?: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 60); };

  return (
    <span className="relative inline-flex align-middle" onMouseEnter={show} onMouseLeave={hide}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        className="inline-flex items-center justify-center rounded-full cursor-help transition-colors"
        style={{ color: 'var(--txt4)' }}
        onFocus={show}
        onBlur={hide}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
      >
        <Info size={size} />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-50 left-1/2 -translate-x-1/2 bottom-full mb-2 w-max max-w-[260px] rounded-lg px-3 py-2 text-xs font-normal leading-snug shadow-lg pointer-events-none"
          style={{ background: 'var(--txt)', color: '#fff', whiteSpace: 'normal' }}
        >
          {text}
          <span
            className="absolute left-1/2 -translate-x-1/2 top-full"
            style={{ width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid var(--txt)' }}
          />
        </span>
      )}
    </span>
  );
}
