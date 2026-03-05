'use client';

import { useState } from 'react';

import { tryParseApiErrorBody, type ApiError } from '../../lib/api';

export type ApiErrorBoxProps = {
  error: ApiError | null | undefined;
  className?: string;
};

function extractMessage(body: unknown): string {
  if (typeof body === 'string') return body;
  if (typeof body === 'object' && body) {
    const obj = body as any;
    if (obj.error) return String(obj.error);
    if (obj.message) return String(obj.message);
    return JSON.stringify(body);
  }
  return 'Unknown error';
}

export function ApiErrorBox({ error, className }: ApiErrorBoxProps) {
  const [showDetails, setShowDetails] = useState(false);

  if (!error) return null;

  const parsed = tryParseApiErrorBody(error.bodyText);
  const message = extractMessage(parsed);
  const hasDetails = error.bodyText && error.bodyText.length > 0;

  return (
    <div
      className={`rounded-card border border-danger/40 bg-danger/10 p-3 ${className ?? ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-medium text-accentRed">{message}</div>
        {hasDetails && (
          <button
            type="button"
            className="shrink-0 text-[10px] text-textMuted underline"
            onClick={() => setShowDetails((v) => !v)}
          >
            {showDetails ? 'Hide' : 'Details'}
          </button>
        )}
      </div>
      {showDetails && error.bodyText && (
        <div className="mt-2 break-all rounded-btn bg-surface p-2 text-[10px] text-textMuted">
          {error.bodyText}
        </div>
      )}
    </div>
  );
}

export function ErrorBox({
  message,
  className,
}: {
  message: string | null;
  className?: string;
}) {
  if (!message) return null;

  return (
    <div
      className={`rounded-card border border-danger/40 bg-danger/10 p-3 ${className ?? ''}`}
    >
      <div className="text-xs font-medium text-accentRed">{message}</div>
    </div>
  );
}
