'use client';

import { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X } from 'lucide-react';

export interface SelectOption { value: string; label: string; }

interface Props {
  name?: string;
  options: SelectOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  emptyLabel?: string;
  required?: boolean;
  disabled?: boolean;
}

// Above modals (z-50) and everything else — matches InfoTooltip/the dashboard
// attendance menu, which hit the identical bug: a `position: absolute`
// dropdown nested inside a modal's `overflow-y-auto` body gets silently
// clipped the moment the trigger sits low enough that the panel would
// extend past the modal's edge. Portaling to document.body with a
// viewport-measured `fixed` position is the only way this can't happen,
// regardless of which scrollable/overflow-hidden ancestor the trigger lives in.
const MENU_Z_INDEX = 2147483647;
const EDGE_MARGIN = 8;

export function SearchableSelect({
  name, options, value: controlled, defaultValue = '',
  onChange, placeholder = 'Select…', emptyLabel, required, disabled,
}: Props) {
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, width: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const value = controlled !== undefined ? controlled : internal;
  const all: SelectOption[] = emptyLabel ? [{ value: '', label: emptyLabel }, ...options] : options;
  const selected = all.find(o => o.value === value);
  const filtered = search.trim()
    ? all.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : all;

  useLayoutEffect(() => { setMounted(true); }, []);

  const reposition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const menuHeight = menuRef.current?.offsetHeight ?? 288;
    // The menu renders at its own natural (content-driven) width — see the
    // `width: max-content` below — not forced to the trigger's width. A
    // compact trigger like "Ongoing (no end…" is much narrower than its
    // longest option ("52 weeks, then stop"), and locking the menu to that
    // width silently clipped option text. offsetWidth here is the ACTUAL
    // rendered (natural) width, used only to keep the menu on-screen.
    const menuWidth = menuRef.current?.offsetWidth ?? rect.width;
    const below = rect.bottom + 4 + menuHeight <= window.innerHeight;
    const top = below ? rect.bottom + 4 : Math.max(EDGE_MARGIN, rect.top - menuHeight - 4);
    let left = rect.left;
    left = Math.max(EDGE_MARGIN, Math.min(left, window.innerWidth - menuWidth - EDGE_MARGIN));
    setPos({ left, top, width: rect.width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const raf = requestAnimationFrame(reposition);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [open, reposition]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
      setSearch('');
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  function pick(opt: SelectOption) {
    if (controlled === undefined) setInternal(opt.value);
    onChange?.(opt.value);
    setOpen(false);
    setSearch('');
  }

  const displayLabel = selected
    ? (selected.value === '' ? selected.label : selected.label)
    : null;

  return (
    <div ref={rootRef} className="relative">
      {name && <input type="hidden" name={name} value={value} />}

      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className="ui-input w-full flex items-center justify-between gap-2 text-left"
        style={{ color: displayLabel && value !== '' ? 'var(--txt)' : 'var(--txt4)' }}
      >
        <span className="flex-1 min-w-0 truncate">
          {displayLabel ?? placeholder}
        </span>
        <ChevronDown
          size={14}
          className="shrink-0 transition-transform"
          style={{ color: 'var(--txt4)', transform: open ? 'rotate(180deg)' : 'none' }}
        />
      </button>

      {open && mounted && createPortal(
        <div
          ref={menuRef}
          data-searchable-select-menu
          className="fixed rounded-xl border border-[var(--bd)] shadow-xl overflow-hidden"
          style={{
            background: 'white', maxHeight: 288, zIndex: MENU_Z_INDEX, left: pos.left, top: pos.top,
            minWidth: pos.width, width: 'max-content', maxWidth: 'min(24rem, calc(100vw - 16px))',
          }}
        >
          {/* Search row */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--bd)]">
            <Search size={13} className="shrink-0" style={{ color: 'var(--txt4)' }} />
            <input
              ref={searchRef}
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className="flex-1 text-sm outline-none bg-transparent"
              style={{ color: 'var(--txt)' }}
            />
            {search && (
              <button type="button" onClick={() => setSearch('')} className="shrink-0">
                <X size={12} style={{ color: 'var(--txt4)' }} />
              </button>
            )}
          </div>

          {/* Options list */}
          <div className="overflow-y-auto" style={{ maxHeight: 232 }}>
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-sm text-center" style={{ color: 'var(--txt4)' }}>
                No results
              </p>
            ) : filtered.map(opt => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value === '' ? '__empty__' : opt.value}
                  type="button"
                  onClick={() => pick(opt)}
                  className="w-full text-left px-3 py-[7px] text-sm truncate transition-colors hover:bg-[var(--sage-lt)]"
                  style={{
                    background: active ? 'var(--sage-lt)' : undefined,
                    color: active ? 'var(--sage-dk)' : opt.value === '' ? 'var(--txt4)' : 'var(--txt)',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
