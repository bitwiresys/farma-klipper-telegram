'use client';

import type { ReactNode } from 'react';

import { useAuth } from '../auth/auth_context';
import { useWs } from '../ws/ws_context';

function Fullscreen({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-4 py-8 text-center">
      {children}
    </div>
  );
}

export function BootstrapGate({ children }: { children: ReactNode }) {
  const a = useAuth();
  const ws = useWs();

  if (a.phase === 'forbidden') {
    return (
      <Fullscreen>
        <div className="text-[18px] font-semibold text-danger">
          ACCESS DENIED
        </div>
        <div className="mt-3 text-xs text-textSecondary">
          Пользователь не аутентифицирован. Данное событие записано в журнал
          авторизаций.
        </div>
        <div className="mt-3 text-xs text-textMuted">
          If you believe this is a mistake, contact the owner.
        </div>
      </Fullscreen>
    );
  }

  if (a.phase === 'need_restart') {
    return (
      <Fullscreen>
        <div className="text-[18px] font-semibold text-warning">
          AUTH SESSION LOST
        </div>
        <div className="mt-3 text-xs text-textSecondary">
          Перезапусти миниапку в Telegram.
        </div>
      </Fullscreen>
    );
  }

  if (a.phase !== 'ready') {
    return (
      <Fullscreen>
        <div className="text-[18px] font-semibold text-textPrimary">
          Loading…
        </div>
        <div className="mt-3 text-xs text-textSecondary">Authorizing…</div>
        <div className="mt-1 text-xs text-textMuted">phase={a.phase}</div>
      </Fullscreen>
    );
  }

  if (ws.status !== 'open') {
    return (
      <Fullscreen>
        <div className="text-[18px] font-semibold text-textPrimary">
          Loading…
        </div>
        <div className="mt-3 text-xs text-textSecondary">Connecting live…</div>
        <div className="mt-1 text-xs text-textMuted">ws={ws.status}</div>
      </Fullscreen>
    );
  }

  return children;
}
