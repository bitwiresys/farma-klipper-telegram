'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

import {
  Bell,
  Clock,
  FolderOpen,
  LayoutGrid,
  Printer,
  Settings,
} from 'lucide-react';

type TabKey = 'dashboard' | 'presets' | 'printers' | 'history' | 'settings';

function titleFromPath(pathname: string): { title: string; tab?: TabKey } {
  if (pathname.startsWith('/dashboard'))
    return { title: 'Dashboard', tab: 'dashboard' };
  if (pathname.startsWith('/presets'))
    return { title: 'Presets', tab: 'presets' };
  if (pathname.startsWith('/printers'))
    return { title: 'Printers', tab: 'printers' };
  if (pathname.startsWith('/history'))
    return { title: 'History', tab: 'history' };
  if (pathname.startsWith('/settings'))
    return { title: 'Settings', tab: 'settings' };
  return { title: 'Farma' };
}

function NavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: ReactNode;
  active: boolean;
}) {
  const pathname = usePathname();
  void pathname;
  return (
    <Link
      href={href}
      className={
        'relative flex flex-col items-center justify-center rounded-btn px-2 py-2 text-[11px] transition active:scale-[0.98] ' +
        (active ? 'text-accentCyan' : 'text-textMuted')
      }
    >
      <div className="mb-1">{icon}</div>
      <div>{label}</div>
      {active && (
        <div className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-accentCyan" />
      )}
    </Link>
  );
}

export function AppShell({
  children,
  wsStatus,
}: {
  children: ReactNode;
  wsStatus?: 'idle' | 'connecting' | 'open' | 'closed' | 'error';
}) {
  const pathname = usePathname();
  const { title, tab } = titleFromPath(pathname);

  const wsText =
    wsStatus === 'open'
      ? 'Live'
      : wsStatus === 'connecting'
        ? 'Reconnecting…'
        : wsStatus === 'error'
          ? 'Error'
          : wsStatus === 'closed'
            ? 'Closed'
            : '';

  const wsDot =
    wsStatus === 'open'
      ? 'bg-success'
      : wsStatus === 'connecting'
        ? 'bg-warning'
        : wsStatus === 'error'
          ? 'bg-danger'
          : 'bg-offlineGray';

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 pb-24 pt-4">
      <div className="rounded-card border border-border/60 bg-surface1/70 p-3 shadow-[0_10px_35px_rgba(0,0,0,0.18)]">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-textMuted">
              FARMA CONTROL
            </div>
            <div className="text-[18px] font-semibold text-textPrimary">
              {title}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex h-11 items-center gap-2 rounded-btn border border-border/50 bg-surface2/70 px-3 text-[11px] text-textSecondary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className={`h-2 w-2 rounded-full ${wsDot}`} />
              <div>{wsText || '—'}</div>
            </div>

            <Link
              href="/settings#notifications"
              className="flex h-11 w-11 items-center justify-center rounded-btn border border-border/70 bg-surface2 text-textSecondary transition active:scale-[0.98]"
              aria-label="Notification settings"
            >
              <Bell size={18} />
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-4 flex-1">{children}</div>

      <div className="fixed bottom-4 left-0 right-0 z-20">
        <div className="mx-auto max-w-xl px-4">
          <div className="grid grid-cols-5 gap-2 rounded-card border border-border/70 bg-surface1 p-2">
            <NavItem
              href="/dashboard"
              label="Dashboard"
              icon={<LayoutGrid size={20} />}
              active={tab === 'dashboard'}
            />
            <NavItem
              href="/presets"
              label="Presets"
              icon={<FolderOpen size={20} />}
              active={tab === 'presets'}
            />
            <NavItem
              href="/printers"
              label="Printers"
              icon={<Printer size={20} />}
              active={tab === 'printers'}
            />
            <NavItem
              href="/history"
              label="History"
              icon={<Clock size={20} />}
              active={tab === 'history'}
            />
            <NavItem
              href="/settings"
              label="Settings"
              icon={<Settings size={20} />}
              active={tab === 'settings'}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
