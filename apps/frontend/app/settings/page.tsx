'use client';

import { useEffect, useMemo, useState } from 'react';

import { BottomSheet } from '../components/ui/BottomSheet';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Switch } from '../components/ui/Switch';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';
import { getBackendBaseUrl, getBackendWsUrl } from '../lib/env';
import { useWs } from '../ws/ws_context';

type NotificationsSettings = {
  notificationsEnabled: boolean;
  notifyFirstLayer: boolean;
  notifyComplete: boolean;
  notifyError: boolean;
};

type SecurityInfo = {
  user: {
    telegramId: string;
    chatId?: string | null;
    firstName: string | null;
    lastName: string | null;
    username: string | null;
    isAllowed: boolean;
  };
  telegram?: {
    botUsername?: string | null;
  };
  allowedTelegramUserIds: number[] | null;
};

type AllowedUserRow = {
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
};

type BackendStatus = { version: string; uptimeSec: number };

function fmtUptime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const mm = String(m).padStart(2, '0');
  const sss = String(ss).padStart(2, '0');
  if (h > 0) return `${h}h ${mm}m`;
  if (m > 0) return `${m}m ${sss}s`;
  return `${ss}s`;
}

export default function SettingsPage() {
  const { token } = useAuth();
  const ws = useWs();
  const [err, setErr] = useState<string | null>(null);

  const [notif, setNotif] = useState<NotificationsSettings | null>(null);
  const [notifLoading, setNotifLoading] = useState(false);

  const [sec, setSec] = useState<SecurityInfo | null>(null);
  const [allowedUsers, setAllowedUsers] = useState<AllowedUserRow[] | null>(
    null,
  );
  const [secLoading, setSecLoading] = useState(false);

  const [status, setStatus] = useState<BackendStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<string | null>(null);

  const wsStatus = ws.status;

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [newTelegramId, setNewTelegramId] = useState('');
  const [addingUser, setAddingUser] = useState(false);

  const [removeUserOpen, setRemoveUserOpen] = useState(false);
  const [removeTelegramId, setRemoveTelegramId] = useState<string | null>(null);
  const [removingUser, setRemovingUser] = useState(false);

  const base = useMemo(() => getBackendBaseUrl(), []);
  const wsUrl = useMemo(() => getBackendWsUrl(), []);

  const botLink = useMemo(() => {
    const u = String(sec?.telegram?.botUsername ?? '')
      .trim()
      .replace(/^@+/, '');
    if (!u) return null;
    return `https://t.me/${u}`;
  }, [sec]);

  const loadNotif = async () => {
    if (!token) return;
    setErr(null);
    setNotifLoading(true);
    try {
      const res = await apiRequest<{ notifications: NotificationsSettings }>(
        '/api/settings/notifications',
        { token },
      );
      setNotif(res.notifications);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setNotifLoading(false);
    }
  };

  const disallowUser = async () => {
    if (!token) return;
    if (!removeTelegramId) return;
    setErr(null);
    setRemovingUser(true);
    try {
      await apiRequest('/api/security/disallow', {
        token,
        method: 'POST',
        body: { telegramId: removeTelegramId },
      });
      setRemoveUserOpen(false);
      setRemoveTelegramId(null);
      await loadSecurity();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemovingUser(false);
    }
  };

  const patchNotif = async (patch: Partial<NotificationsSettings>) => {
    if (!token) return;
    setErr(null);
    try {
      const res = await apiRequest<{ notifications: NotificationsSettings }>(
        '/api/settings/notifications',
        { token, method: 'PATCH', body: patch },
      );
      setNotif(res.notifications);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const loadSecurity = async () => {
    if (!token) return;
    setErr(null);
    setSecLoading(true);
    try {
      const res = await apiRequest<SecurityInfo>('/api/security', { token });
      setSec(res);

      if (res.allowedTelegramUserIds === null) {
        try {
          const r2 = await apiRequest<{ allowedUsers: AllowedUserRow[] }>(
            '/api/security/allowed-users',
            { token },
          );
          setAllowedUsers(r2.allowedUsers);
        } catch {
          setAllowedUsers([]);
        }
      } else {
        setAllowedUsers(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSecLoading(false);
    }
  };

  const addAllowedUser = async () => {
    if (!token) return;
    setErr(null);
    setAddingUser(true);
    try {
      await apiRequest('/api/security/allow', {
        token,
        method: 'POST',
        body: { telegramId: newTelegramId.trim() },
      });
      setNewTelegramId('');
      setAddUserOpen(false);
      await loadSecurity();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAddingUser(false);
    }
  };

  const loadBackendStatus = async () => {
    if (!token) return;
    setErr(null);
    setStatusLoading(true);
    try {
      const res = await apiRequest<BackendStatus>('/api/status', { token });
      setStatus(res);
      setStatusUpdatedAt(new Date().toISOString());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setStatusLoading(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    void loadNotif();
    void loadSecurity();
    void loadBackendStatus();
  }, [token]);

  const reconnectWs = () => {
    ws.reconnect();
  };

  return (
    <div className="space-y-3">
      {!token && (
        <div className="text-xs text-textSecondary">Login required.</div>
      )}

      {token && err && (
        <div className="break-all text-xs text-red-400">{err}</div>
      )}

      <div id="notifications">
        <Card className="p-3">
          <div className="text-xs font-medium text-textPrimary">
            Notifications
          </div>
          <div className="mt-2 text-xs text-textMuted">
            No spam: each event once per print session.
          </div>

          {sec?.user?.isAllowed && !sec?.user?.chatId && (
            <div className="mt-3 rounded-card border border-warning/30 bg-warning/10 p-3 text-xs text-textPrimary">
              <div className="font-medium">Action required</div>
              <div className="mt-1 text-textSecondary">
                Telegram doesn’t allow bots to message users until the user
                opens a chat with the bot first. Open the bot and press /start
                once.
              </div>
              <div className="mt-3">
                {botLink ? (
                  <a
                    href={botLink}
                    className="block"
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Button className="w-full" variant="secondary">
                      Open bot
                    </Button>
                  </a>
                ) : (
                  <div className="text-[11px] text-textMuted">
                    Bot link is unavailable. Backend could not resolve bot
                    username via Telegram Bot API (getMe). Check that
                    TELEGRAM_BOT_TOKEN is valid and backend has internet access.
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="text-textPrimary">Notifications enabled</div>
              <Switch
                checked={Boolean(notif?.notificationsEnabled)}
                disabled={!token || notifLoading || !notif}
                onChange={(next) =>
                  void patchNotif({ notificationsEnabled: next })
                }
              />
            </div>

            <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="text-textPrimary">First layer done</div>
              <Switch
                checked={Boolean(notif?.notifyFirstLayer)}
                disabled={
                  !token ||
                  notifLoading ||
                  !notif ||
                  !notif.notificationsEnabled
                }
                onChange={(next) => void patchNotif({ notifyFirstLayer: next })}
              />
            </div>

            <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="text-textPrimary">Print complete</div>
              <Switch
                checked={Boolean(notif?.notifyComplete)}
                disabled={
                  !token ||
                  notifLoading ||
                  !notif ||
                  !notif.notificationsEnabled
                }
                onChange={(next) => void patchNotif({ notifyComplete: next })}
              />
            </div>

            <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="text-textPrimary">Print error</div>
              <Switch
                checked={Boolean(notif?.notifyError)}
                disabled={
                  !token ||
                  notifLoading ||
                  !notif ||
                  !notif.notificationsEnabled
                }
                onChange={(next) => void patchNotif({ notifyError: next })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="secondary"
                onClick={() => void loadNotif()}
                disabled={!token || notifLoading}
              >
                {notifLoading ? 'Loading…' : 'Reload'}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-3">
        <div className="text-xs font-medium text-textPrimary">Security</div>
        <div className="mt-2 text-xs text-textMuted">
          Only whitelisted users can access.
        </div>

        <div className="mt-3 space-y-2">
          <div className="rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textPrimary">You</div>
            <div className="mt-1 text-textSecondary">
              id: {sec?.user.telegramId ?? '—'}
            </div>
            <div className="mt-1 text-textMuted">
              @{sec?.user.username ?? '—'}
            </div>
          </div>

          <div className="rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textPrimary">Allowed Telegram users</div>

            {sec?.allowedTelegramUserIds && (
              <div className="mt-2 space-y-1">
                {sec.allowedTelegramUserIds.map((id) => (
                  <div key={id} className="font-mono text-textSecondary">
                    {id}
                  </div>
                ))}
              </div>
            )}

            {sec?.allowedTelegramUserIds === null && (
              <div className="mt-2 space-y-1">
                {(allowedUsers ?? []).map((u) => (
                  <div
                    key={u.telegramId}
                    className="flex items-center justify-between gap-2 text-textSecondary"
                  >
                    <div className="min-w-0">
                      <span className="font-mono">{u.telegramId}</span>
                      {u.username ? ` @${u.username}` : ''}
                    </div>
                    <Button
                      variant="destructive"
                      className="shrink-0 px-2 py-1"
                      onClick={() => {
                        setRemoveTelegramId(u.telegramId);
                        setRemoveUserOpen(true);
                      }}
                      disabled={u.telegramId === sec?.user.telegramId}
                    >
                      Remove
                    </Button>
                  </div>
                ))}

                {(allowedUsers ?? []).length === 0 && (
                  <div className="text-textMuted">No allowed users yet.</div>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => void loadSecurity()}
              disabled={!token || secLoading}
            >
              {secLoading ? 'Loading…' : 'Reload'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setAddUserOpen(true)}
              disabled={!token || sec?.allowedTelegramUserIds !== null}
            >
              Add user id
            </Button>
          </div>

          {sec?.allowedTelegramUserIds !== null && (
            <div className="text-xs text-textMuted">
              Allowlist is managed by backend env.
            </div>
          )}
        </div>
      </Card>

      <Card className="p-3">
        <div className="text-xs font-medium text-textPrimary">
          Backend status
        </div>

        <div className="mt-2 space-y-2 text-xs">
          <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textSecondary">Version</div>
            <div className="font-mono text-textPrimary">
              {status?.version ?? '—'}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textSecondary">Uptime</div>
            <div className="font-mono text-textPrimary">
              {status ? fmtUptime(status.uptimeSec) : '—'}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textSecondary">Last updated</div>
            <div className="font-mono text-textPrimary">
              {statusUpdatedAt
                ? new Date(statusUpdatedAt).toLocaleString()
                : '—'}
            </div>
          </div>
          <div className="flex items-center justify-between rounded-btn border border-border/45 bg-surface2/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textSecondary">WS</div>
            <div className="font-mono text-textPrimary">{wsStatus}</div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => void loadBackendStatus()}
              disabled={!token || statusLoading}
            >
              {statusLoading ? 'Loading…' : 'Reload'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => reconnectWs()}
              disabled={!token}
            >
              Reconnect
            </Button>
          </div>

          <div className="rounded-btn border border-border/45 bg-surface2/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textMuted">NEXT_PUBLIC_BACKEND_BASE_URL</div>
            <div className="mt-1 break-all font-mono text-textSecondary">
              {base || '—'}
            </div>
            <div className="mt-2 text-textMuted">
              NEXT_PUBLIC_BACKEND_WS_URL
            </div>
            <div className="mt-1 break-all font-mono text-textSecondary">
              {wsUrl || '—'}
            </div>
          </div>
        </div>
      </Card>

      <BottomSheet
        open={addUserOpen}
        onClose={() => setAddUserOpen(false)}
        title="Add user id"
      >
        <div className="space-y-3">
          <div className="text-xs text-textSecondary">
            Enter Telegram numeric user id.
          </div>
          <input
            className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
            placeholder="123456789"
            value={newTelegramId}
            onChange={(e) => setNewTelegramId(e.target.value)}
            inputMode="numeric"
          />
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => setAddUserOpen(false)}
              disabled={addingUser}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void addAllowedUser()}
              disabled={!newTelegramId.trim() || addingUser}
            >
              {addingUser ? 'Adding…' : 'Add'}
            </Button>
          </div>
        </div>
      </BottomSheet>

      <BottomSheet
        open={removeUserOpen}
        onClose={() => setRemoveUserOpen(false)}
        title="Remove user"
      >
        <div className="space-y-3">
          <div className="text-xs text-textSecondary">
            This user will lose access to the panel.
          </div>
          <div className="rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="text-textMuted">Telegram user id</div>
            <div className="mt-1 font-mono text-textPrimary">
              {removeTelegramId ?? '—'}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => setRemoveUserOpen(false)}
              disabled={removingUser}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void disallowUser()}
              disabled={!removeTelegramId || removingUser}
            >
              {removingUser ? 'Removing…' : 'Remove'}
            </Button>
          </div>
        </div>
      </BottomSheet>
    </div>
  );
}
