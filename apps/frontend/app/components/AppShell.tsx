'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import { useAuth } from '../auth/auth_context';

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={
        'flex-1 rounded px-2 py-2 text-center text-xs ' +
        (active ? 'bg-slate-200 text-slate-950' : 'bg-slate-900/40 text-slate-200')
      }
    >
      {label}
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const v = process.env.NEXT_PUBLIC_APP_VERSION ?? '';

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-lg font-semibold">Farma</div>
          <div className="text-xs text-slate-400">READ-ONLY mode</div>
        </div>

        <div className="text-right text-xs text-slate-400">
          <div>v={v || '-'}</div>
          <div>{token ? 'auth: ok' : 'auth: none'}</div>
        </div>
      </div>

      <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3 text-xs text-slate-200">
        <div className="font-medium">READ-ONLY mode enabled</div>
        <div className="mt-1 text-slate-300">UI не содержит кнопок управления печатью.</div>
      </div>

      <div className="mt-4 flex-1">{children}</div>

      <div className="mt-4 grid grid-cols-5 gap-2">
        <NavItem href="/dashboard" label="Dashboard" />
        <NavItem href="/printers" label="Printers" />
        <NavItem href="/history" label="History" />
        <NavItem href="/presets" label="Presets" />
        <NavItem href="/settings" label="Settings" />
      </div>
    </div>
  );
}
