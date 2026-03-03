'use client';

import { useMemo, useState } from 'react';

import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { getBackendBaseUrl, getBackendWsUrl } from '../lib/env';

export default function SettingsPage() {
  const { token } = useAuth();
  const [health, setHealth] = useState<string>('(not pinged)');

  const base = useMemo(() => getBackendBaseUrl(), []);
  const ws = useMemo(() => getBackendWsUrl(), []);

  const ping = async () => {
    try {
      const res = await apiRequest('/api/health');
      setHealth(JSON.stringify(res));
    } catch (e) {
      setHealth(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AppShell>
      <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-sm font-medium">Settings</div>
        <div className="mt-1 text-xs text-slate-400">Soon</div>

        <div className="mt-4 text-xs">
          <div className="text-slate-400">NEXT_PUBLIC_BACKEND_BASE_URL</div>
          <div className="break-all font-mono">{base || '(not set)'}</div>

          <div className="mt-3 text-slate-400">NEXT_PUBLIC_BACKEND_WS_URL</div>
          <div className="break-all font-mono">{ws || '(not set)'}</div>

          <div className="mt-3 text-slate-400">auth</div>
          <div className="break-all font-mono">{token ? 'token present' : 'no token'}</div>

          <div className="mt-3 flex gap-2">
            <button className="flex-1 rounded bg-slate-950 px-3 py-2 text-xs" onClick={() => void ping()}>
              Ping /api/health
            </button>
          </div>

          <div className="mt-3 rounded bg-slate-950 p-3 font-mono text-xs">{health}</div>
        </div>
      </div>
    </AppShell>
  );
}
