'use client';

import type { ReactNode } from 'react';

export function BottomSheet({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50">
      <button
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
        aria-label="Close"
      />
      <div className="absolute bottom-0 left-0 right-0 mx-auto w-full max-w-xl rounded-t-card border border-border/70 bg-surface1 p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-textPrimary">{title}</div>
          <button
            className="rounded-btn px-3 py-2 text-xs text-textSecondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}
