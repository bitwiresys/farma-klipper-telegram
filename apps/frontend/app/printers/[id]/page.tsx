'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import type { PrinterDto } from '../../lib/dto';

import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../auth/auth_context';
import { apiRequest, tryParseApiErrorBody, type ApiError } from '../../lib/api';
import { useWs } from '../../ws/ws_context';

type WsEvent = { type: string; payload: any };

function fmtNum(x: number | null | undefined, digits = 1): string {
  if (x === null || x === undefined) return '-';
  const p = Math.pow(10, digits);
  return String(Math.round(x * p) / p);
}

function fmtPct01(x: number | null | undefined): string {
  if (x === null || x === undefined) return '-';
  return `${Math.round(x * 100)}%`;
}

function fmtEta(sec: number | null | undefined): string {
  if (sec === null || sec === undefined) return '-';
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default function PrinterDetailsPage() {
  const { token } = useAuth();
  const ws = useWs();
  const params = useParams() as any;
  const printerId = String(params?.id ?? '');

  const [err, setErr] = useState<string | null>(null);
  const [printer, setPrinter] = useState<PrinterDto | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [modelId, setModelId] = useState('');
  const [moonrakerBaseUrl, setMoonrakerBaseUrl] = useState('');
  const [moonrakerApiKey, setMoonrakerApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  const [testing, setTesting] = useState(false);
  const [testedOk, setTestedOk] = useState(false);
  const [saving, setSaving] = useState(false);

  const [confirmRemoveOpen, setConfirmRemoveOpen] = useState(false);

  const state = printer?.snapshot?.state ?? 'offline';

  const load = async () => {
    if (!token || !printerId) return;
    setErr(null);
    const res = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', {
      token,
    });
    const p = res.printers.find((x) => x.id === printerId) ?? null;
    setPrinter(p);

    const m = await apiRequest<{ models: Array<{ id: string; name: string }> }>(
      '/api/printer-models',
      { token },
    );
    setModels(m.models);
  };

  useEffect(() => {
    void load();
  }, [token, printerId]);

  useEffect(() => {
    if (!printer) return;
    setDisplayName(printer.displayName ?? '');
    setModelId(printer.modelId ?? '');
    setMoonrakerBaseUrl('');
    setMoonrakerApiKey('');
    setTestedOk(false);
  }, [printer?.id]);

  useEffect(() => {
    if (!token || !printerId) return;
    return ws.subscribe((ev) => {
      const e = ev as WsEvent;
      if (e.type !== 'PRINTER_STATUS') return;
      const p = e.payload?.printer as PrinterDto | undefined;
      if (!p) return;
      if (p.id !== printerId) return;
      setPrinter(p);
    });
  }, [token, printerId, ws]);

  const testConnection = async () => {
    if (!token) return;
    setErr(null);
    setTesting(true);
    setTestedOk(false);
    try {
      await apiRequest(`/api/printers/${printerId}/test`, {
        token,
        method: 'POST',
      });
      setTestedOk(true);
    } catch (e) {
      const ae = e as ApiError;
      const parsed = tryParseApiErrorBody(ae.bodyText);
      setErr(
        typeof parsed === 'object' && parsed
          ? JSON.stringify(parsed)
          : ae.bodyText,
      );
    } finally {
      setTesting(false);
    }
  };

  const rescanSpecs = async () => {
    if (!token) return;
    setErr(null);
    setTesting(true);
    try {
      await apiRequest(`/api/printers/${printerId}/rescan`, {
        token,
        method: 'POST',
      });
      await load();
      setTestedOk(true);
    } catch (e) {
      const ae = e as ApiError;
      const parsed = tryParseApiErrorBody(ae.bodyText);
      setErr(
        typeof parsed === 'object' && parsed
          ? JSON.stringify(parsed)
          : ae.bodyText,
      );
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!token) return;
    if (!printer) return;
    if (!testedOk) return;

    setErr(null);
    setSaving(true);
    try {
      await apiRequest(`/api/printers/${printerId}`, {
        token,
        method: 'PATCH',
        body: {
          displayName: displayName.trim(),
          modelId,
          moonrakerBaseUrl: moonrakerBaseUrl.trim() || undefined,
          moonrakerApiKey: moonrakerApiKey.trim() || undefined,
        },
      });
      await load();
    } catch (e) {
      const ae = e as ApiError;
      const parsed = tryParseApiErrorBody(ae.bodyText);
      setErr(
        typeof parsed === 'object' && parsed
          ? JSON.stringify(parsed)
          : ae.bodyText,
      );
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!token) return;
    setErr(null);
    setSaving(true);
    try {
      await apiRequest(`/api/printers/${printerId}`, {
        token,
        method: 'DELETE',
      });
      window.location.href = '/printers';
    } catch (e) {
      const ae = e as ApiError;
      const parsed = tryParseApiErrorBody(ae.bodyText);
      setErr(
        typeof parsed === 'object' && parsed
          ? JSON.stringify(parsed)
          : ae.bodyText,
      );
    } finally {
      setSaving(false);
    }
  };

  const saveDisabled =
    !displayName.trim() || !modelId.trim() || !testedOk || saving;

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Edit printer</div>
        <Link href="/printers">
          <Button variant="ghost">Back</Button>
        </Link>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-textSecondary">Login required.</div>
      )}
      {token && err && (
        <div className="mt-3 break-all text-xs text-red-400">{err}</div>
      )}

      {token && !printer && (
        <div className="mt-3 text-xs text-textSecondary">Loading…</div>
      )}

      {token && printer && (
        <div className="mt-3 space-y-3">
          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">Status</div>
            <div className="mt-2 text-xs text-textSecondary">
              Live: {String(state)}
            </div>
            <div className="mt-2 text-xs text-textMuted">
              File: {printer.snapshot.filename ?? '—'}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-btn border border-border/70 bg-surface2 p-2">
                <div className="text-textMuted">Progress</div>
                <div className="text-textPrimary">
                  {fmtPct01(printer.snapshot.progress)}
                </div>
              </div>
              <div className="rounded-btn border border-border/70 bg-surface2 p-2">
                <div className="text-textMuted">ETA</div>
                <div className="text-textPrimary">
                  {fmtEta(printer.snapshot.etaSec)}
                </div>
              </div>
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">Fields</div>
            <div className="mt-2 grid gap-2">
              <input
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setTestedOk(false);
                }}
              />

              <select
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setTestedOk(false);
                }}
              >
                <option value="">Model…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <input
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                placeholder="Moonraker URL (leave empty to keep current)"
                value={moonrakerBaseUrl}
                onChange={(e) => {
                  setMoonrakerBaseUrl(e.target.value);
                  setTestedOk(false);
                }}
              />

              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                  placeholder="API Key (leave empty to keep current)"
                  type={showKey ? 'text' : 'password'}
                  value={moonrakerApiKey}
                  onChange={(e) => {
                    setMoonrakerApiKey(e.target.value);
                    setTestedOk(false);
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? 'Hide' : 'Show'}
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">
              Connection
            </div>
            <div className="mt-2 space-y-2">
              <Button
                variant="primary"
                onClick={() => void testConnection()}
                disabled={testing}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </Button>

              <Button
                variant="secondary"
                onClick={() => void rescanSpecs()}
                disabled={testing}
              >
                Rescan specs
              </Button>

              <div className="text-xs text-textMuted">
                Refresh bed size & nozzle from printer
              </div>
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">
              Detected specs
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <div className="rounded-btn border border-border/70 bg-surface2 p-2">
                <div className="text-textMuted">Bed size</div>
                <div className="text-textPrimary">
                  {fmtNum(printer.bedX, 0)}×{fmtNum(printer.bedY, 0)}×
                  {fmtNum(printer.bedZ, 0)}
                </div>
              </div>
              <div className="rounded-btn border border-border/70 bg-surface2 p-2">
                <div className="text-textMuted">Nozzle</div>
                <div className="text-textPrimary">
                  {fmtNum(printer.nozzleDiameter, 2)}
                </div>
              </div>
            </div>
          </Card>

          <Button
            className="w-full"
            variant="primary"
            onClick={() => void save()}
            disabled={saveDisabled}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Link href="/printers" className="block">
              <Button className="w-full" variant="ghost">
                Cancel
              </Button>
            </Link>
            <Button
              className="w-full"
              variant="destructive"
              onClick={() => setConfirmRemoveOpen(true)}
              disabled={saving}
            >
              Remove
            </Button>
          </div>

          <BottomSheet
            open={confirmRemoveOpen}
            onClose={() => setConfirmRemoveOpen(false)}
            title="Remove printer?"
          >
            <div className="space-y-3">
              <div className="text-xs text-textSecondary">
                {printer.displayName}
              </div>
              <div className="text-xs text-textMuted">
                History and presets will stay.
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmRemoveOpen(false)}
                  disabled={saving}
                >
                  Keep
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => void remove()}
                  disabled={saving}
                >
                  Remove
                </Button>
              </div>
            </div>
          </BottomSheet>
        </div>
      )}
    </>
  );
}
