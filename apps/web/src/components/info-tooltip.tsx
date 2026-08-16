'use client';

import { Info } from 'lucide-react';
import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';

/** Gap kept between the bubble and the edge of the window. */
const EDGE_MARGIN = 8;
/** Above absolutely everything — modals (z-50), sticky calendar headers, the
 * notification bell dropdown, etc. This bubble must never lose to any of them. */
const TOOLTIP_Z_INDEX = 2147483647;

/**
 * A small circle-i icon that reveals a plain-language explanation on hover,
 * focus, or tap. Use it next to anything a parent/student might find confusing.
 *
 *   <InfoTooltip text="We only offer times the teacher is actually free." />
 *
 * The bubble is portaled to document.body and positioned with `fixed`
 * coordinates measured straight from the icon, rather than living inside
 * whatever ancestor happens to render this component. An `absolute` bubble
 * nested a few levels deep can end up trapped in an ancestor's stacking
 * context (any `position` + z-index, `overflow: hidden`, or `transform`
 * creates one) — a sibling elsewhere on the page with its own stacking
 * context can then render on top even with a lower z-index, or the ancestor's
 * overflow can clip the bubble outright. Escaping to body via a portal, with
 * the highest possible z-index, is the only way this can't happen.
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
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, below: false });
  const tipRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Portals need a document to exist — deferred to an effect so this stays
  // SSR-safe (matches the hydrated markup on first client render).
  useLayoutEffect(() => { setMounted(true); }, []);

  const show = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 60); };

  const reposition = useCallback(() => {
    const icon = iconRef.current;
    if (!icon) return;
    const iconRect = icon.getBoundingClientRect();
    const tipWidth = tipRef.current?.offsetWidth ?? 260;
    const tipHeight = tipRef.current?.offsetHeight ?? 0;

    const iconCenterX = iconRect.left + iconRect.width / 2;
    let left = iconCenterX - tipWidth / 2;
    left = Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - tipWidth - EDGE_MARGIN));

    const below = iconRect.top - tipHeight - 8 < EDGE_MARGIN;
    const top = below ? iconRect.bottom + 8 : iconRect.top - tipHeight - 8;

    setPos({ left, top, below });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    // A second pass once the bubble has actually rendered and has real
    // dimensions — the first pass runs with tipRef still null/stale width.
    const raf = requestAnimationFrame(reposition);
    window.addEventListener('resize', reposition);
    // Capture phase so scrolling any ancestor pane — not just the window —
    // keeps the bubble anchored.
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  return (
    <span className="relative inline-flex align-middle" onMouseEnter={show} onMouseLeave={hide}>
      <button
        ref={iconRef}
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
      {open && mounted && createPortal(
        <div
          ref={tipRef}
          role="tooltip"
          className="fixed w-max max-w-[260px] rounded-lg px-3 py-2 text-xs font-normal leading-snug shadow-lg pointer-events-none"
          style={{
            zIndex: TOOLTIP_Z_INDEX,
            left: pos.left,
            top: pos.top,
            background: 'var(--txt)',
            color: '#fff',
            whiteSpace: 'normal',
          }}
        >
          {text}
        </div>,
        document.body,
      )}
    </span>
  );
}
