'use client';

import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}

export function Modal({ open, onClose, title, children, maxWidth = 'max-w-lg' }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div className={`relative w-full ${maxWidth} rounded-[20px] overflow-hidden max-h-[90vh] flex flex-col`}
        style={{ background: 'var(--card)', boxShadow: '0 8px 48px rgba(0,0,0,.15), 0 2px 10px rgba(0,0,0,.08)' }}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 shrink-0 border-b"
          style={{ borderColor: 'var(--bd)', background: 'linear-gradient(135deg, var(--sage-lt) 0%, transparent 60%)' }}>
          <h2 className="font-extrabold tracking-tight"
            style={{ fontSize: '1.0625rem', color: 'var(--txt)', letterSpacing: '-0.01em' }}>
            {title}
          </h2>
          <button onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors hover:bg-black/6"
            style={{ color: 'var(--txt4)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto px-6 py-6">
          {children}
        </div>
      </div>
    </div>
  );
}
