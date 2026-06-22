'use client';

import { useState, useRef, useEffect } from 'react';
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

export function SearchableSelect({
  name, options, value: controlled, defaultValue = '',
  onChange, placeholder = 'Select…', emptyLabel, required, disabled,
}: Props) {
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const value = controlled !== undefined ? controlled : internal;
  const all: SelectOption[] = emptyLabel ? [{ value: '', label: emptyLabel }, ...options] : options;
  const selected = all.find(o => o.value === value);
  const filtered = search.trim()
    ? all.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : all;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
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

      {open && (
        <div
          className="absolute z-[200] left-0 right-0 mt-1 rounded-xl border border-[var(--bd)] shadow-xl overflow-hidden"
          style={{ background: 'white', maxHeight: 288 }}
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
                  className="w-full text-left px-3 py-[7px] text-sm transition-colors hover:bg-[var(--sage-lt)]"
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
        </div>
      )}
    </div>
  );
}
