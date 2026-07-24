'use client';

import { Info } from 'lucide-react';
import { useState, useRef, useLayoutEffect, useCallback } from 'react';

/** Gap kept between the bubble and the edge of the window. */
const EDGE_MARGIN = 8;

/**
 * A small circle-i icon that reveals a plain-language explanation on hover,
 * focus, or tap. Use it next to anything a parent/student might find confusing.
 *
 *   <InfoTooltip text="We only offer times the teacher is actually free." />
 *
 * The bubble is centred on the icon by default, but icons often sit in the
 * top-right of a toolbar — where a centred 260px bubble runs off the side of
 * the window and gets clipped by the scroll container. After opening we measure
 * it and nudge it back inside the window, flipping it below the icon if there
 * isn't room above. The measuring is done in a layout effect so the correction
 * lands in the same frame and the bubble never appears in the wrong spot.
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
  // shiftX slides the bubble horizontally off its centred position; `below`
  // flips it under the icon. Both are recomputed every time it opens.
  const [shiftX, setShiftX] = useState(0);
  const [below, setBelow] = useState(false);
  const tipRef = useRef<HTMLSpanElement>(null);
  const iconRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => { if (closeTimer.current) clearTimeout(closeTimer.current); setOpen(true); };
  const hide = () => { closeTimer.current = setTimeout(() => setOpen(false), 60); };

  const reposition = useCallback(() => {
    const tip = tipRef.current;
    const icon = iconRef.current;
    if (!tip || !icon) return;

    const rect = tip.getBoundingClientRect();
    // Undo the shift already applied so repeated runs correct the same
    // baseline instead of compounding.
    const left = rect.left - shiftX;
    const right = rect.right - shiftX;

    let next = 0;
    if (left < EDGE_MARGIN) next = EDGE_MARGIN - left;
    else if (right > window.innerWidth - EDGE_MARGIN) next = window.innerWidth - EDGE_MARGIN - right;
    // A bubble wider than the window can't satisfy both edges; favour the left
    // so the sentence starts where it will be read.
    if (left + next < EDGE_MARGIN) next = EDGE_MARGIN - left;
    setShiftX(next);

    // Decide from the icon, not the bubble, so the answer doesn't depend on
    // where we last put the bubble — otherwise it can flip back and forth.
    const iconTop = icon.getBoundingClientRect().top;
    setBelow(iconTop - rect.height - 8 < EDGE_MARGIN);
  }, [shiftX]);

  useLayoutEffect(() => {
    if (!open) {
      setShiftX(0);
      setBelow(false);
      return;
    }
    reposition();
    window.addEventListener('resize', reposition);
    // Capture phase so scrolling any ancestor pane — not just the window —
    // keeps the bubble anchored.
    window.addEventListener('scroll', reposition, true);
    return () => {
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
      {open && (
        <span
          ref={tipRef}
          role="tooltip"
          className={`absolute z-50 left-1/2 w-max max-w-[260px] rounded-lg px-3 py-2 text-xs font-normal leading-snug shadow-lg pointer-events-none ${
            below ? 'top-full mt-2' : 'bottom-full mb-2'
          }`}
          style={{
            background: 'var(--txt)',
            color: '#fff',
            whiteSpace: 'normal',
            transform: `translateX(calc(-50% + ${shiftX}px))`,
          }}
        >
          {text}
          {/* The arrow stays on the icon while the bubble slides, so it keeps
              pointing at what it describes. */}
          <span
            className={`absolute left-1/2 ${below ? 'bottom-full' : 'top-full'}`}
            style={{
              transform: `translateX(calc(-50% - ${shiftX}px))`,
              width: 0,
              height: 0,
              borderLeft: '5px solid transparent',
              borderRight: '5px solid transparent',
              ...(below
                ? { borderBottom: '5px solid var(--txt)' }
                : { borderTop: '5px solid var(--txt)' }),
            }}
          />
        </span>
      )}
    </span>
  );
}
