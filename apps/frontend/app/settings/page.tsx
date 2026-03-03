'use client';

import { useMemo, useState } from 'react';

import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { getBackendBaseUrl, getBackendWsUrl } from '../lib/env';

type NotificationsSettings = {
  notificationsEnabled: boolean;
  notifyFirstLayer: boolean;
  notifyComplete: boolean;
  notifyError: boolean;
};

export default function SettingsPage() {
  const { token } = useAuth();
  const [health, setHealth] = useState<string>('(not pinged)');
  const [notif, setNotif] = useState<NotificationsSettings | null>(null);
  const [notifErr, setNotifErr] = useState<string | null>(null);

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

  const loadNotif = async () => {
    if (!token) return;
    setNotifErr(null);
    try {
      const res = await apiRequest<{ notifications: NotificationsSettings }>(
        '/api/settings/notifications',
        { token },
      );
      setNotif(res.notifications);
    } catch (e) {
      setNotifErr(e instanceof Error ? e.message : String(e));
    }
  };

  const patchNotif = async (patch: Partial<NotificationsSettings>) => {
    if (!token) return;
    setNotifErr(null);
    try {
      const res = await apiRequest<{ notifications: NotificationsSettings }>(
        '/api/settings/notifications',
        { token, method: 'PATCH', body: patch },
      );
      setNotif(res.notifications);
    } catch (e) {
      setNotifErr(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <AppShell>
      <div className="rounded border border-slate-800 bg-slate-900/40 p-4">
        <div className="text-sm font-medium">Settings</div>
        <div className="mt-1 text-xs text-slate-400">Notifications</div>

        {!token && (
          <div className="mt-2 text-xs text-slate-400">Login required.</div>
        )}

        {token && (
          <div className="mt-3">
            <button
              className="w-full rounded bg-slate-950 px-3 py-2 text-xs"
              onClick={() => void loadNotif()}
            >
              Load notification settings
            </button>

            {notifErr && (
              <div className="mt-2 break-all text-xs text-red-400">
                {notifErr}
              </div>
            )}

            {notif && (
              <div className="mt-3 grid gap-2 text-xs">
                <label className="flex items-center justify-between rounded bg-slate-950 p-2">
                  <span>Notifications enabled</span>
                  <input
                    type="checkbox"
                    checked={notif.notificationsEnabled}
                    onChange={(e) =>
                      void patchNotif({
                        notificationsEnabled: e.target.checked,
                      })
                    }
                  />
                </label>

                <label className="flex items-center justify-between rounded bg-slate-950 p-2">
                  <span>First layer done</span>
                  <input
                    type="checkbox"
                    checked={notif.notifyFirstLayer}
                    onChange={(e) =>
                      void patchNotif({ notifyFirstLayer: e.target.checked })
                    }
                  />
                </label>

                <label className="flex items-center justify-between rounded bg-slate-950 p-2">
                  <span>Print complete</span>
                  <input
                    type="checkbox"
                    checked={notif.notifyComplete}
                    onChange={(e) =>
                      void patchNotif({ notifyComplete: e.target.checked })
                    }
                  />
                </label>

                <label className="flex items-center justify-between rounded bg-slate-950 p-2">
                  <span>Print error</span>
                  <input
                    type="checkbox"
                    checked={notif.notifyError}
                    onChange={(e) =>
                      void patchNotif({ notifyError: e.target.checked })
                    }
                  />
                </label>

                <div className="rounded bg-slate-950 p-3 text-xs text-slate-300">
                  <div className="text-slate-400">
                    Layers require SET_PRINT_STATS_INFO
                  </div>
                  <div className="mt-1">
                    Enable Klipper macro/config to report
                    current_layer/total_layer.
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 text-xs">
          <div className="text-slate-400">NEXT_PUBLIC_BACKEND_BASE_URL</div>
          <div className="break-all font-mono">{base || '(not set)'}</div>

          <div className="mt-3 text-slate-400">NEXT_PUBLIC_BACKEND_WS_URL</div>
          <div className="break-all font-mono">{ws || '(not set)'}</div>

          <div className="mt-3 text-slate-400">auth</div>
          <div className="break-all font-mono">
            {token ? 'token present' : 'no token'}
          </div>

          <div className="mt-3 flex gap-2">
            <button
              className="flex-1 rounded bg-slate-950 px-3 py-2 text-xs"
              onClick={() => void ping()}
            >
              Ping /api/health
            </button>
          </div>

          <div className="mt-3 rounded bg-slate-950 p-3 font-mono text-xs">
            {health}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
