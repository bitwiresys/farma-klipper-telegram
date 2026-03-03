'use client';

import { useEffect, useState } from 'react';

import type { PrinterDto } from '../lib/dto';

import { AppShell } from '../components/AppShell';
import { useAuth } from '../auth/auth_context';
import { apiRequest } from '../lib/api';

export default function PrintersPage() {
  const { token } = useAuth();
  const [err, setErr] = useState<string | null>(null);

  const devOnly = process.env.NEXT_PUBLIC_DEV_ONLY === '1';

  const [printers, setPrinters] = useState<PrinterDto[]>([]);
  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  const [newModelName, setNewModelName] = useState('');
  const [newPrinter, setNewPrinter] = useState({
    displayName: '',
    modelId: '',
    moonrakerBaseUrl: '',
    moonrakerApiKey: '',
  });

  const load = async () => {
    if (!token) return;
    setErr(null);
    const p = await apiRequest<{ printers: PrinterDto[] }>('/api/printers', { token });
    setPrinters(p.printers);
    const m = await apiRequest<{ models: Array<{ id: string; name: string }> }>('/api/printer-models', { token });
    setModels(m.models);
  };

  useEffect(() => {
    void load();
  }, [token]);

  const createModelInline = async () => {
    if (!token) return;
    setErr(null);
    if (!newModelName.trim()) return;
    await apiRequest('/api/printer-models', { token, method: 'POST', body: { name: newModelName.trim() } });
    setNewModelName('');
    await load();
  };

  const createPrinter = async () => {
    if (!token) return;
    setErr(null);
    await apiRequest('/api/printers', { token, method: 'POST', body: newPrinter });
    setNewPrinter({ displayName: '', modelId: '', moonrakerBaseUrl: '', moonrakerApiKey: '' });
    await load();
  };

  const testPrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${id}/test`, { token, method: 'POST' });
  };

  const rescanPrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${id}/rescan`, { token, method: 'POST' });
    await load();
  };

  const removePrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${id}`, { token, method: 'DELETE' });
    await load();
  };

  const pausePrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${id}/pause`, { token, method: 'POST' });
  };

  const resumePrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${id}/resume`, { token, method: 'POST' });
  };

  const cancelPrinter = async (id: string) => {
    if (!token) return;
    setErr(null);
    await apiRequest(`/api/printers/${id}/cancel`, { token, method: 'POST' });
  };

  return (
    <AppShell>
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Printers</div>
        <button className="rounded bg-slate-950 px-3 py-2 text-xs" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {!token && <div className="mt-3 text-xs text-slate-400">Login required.</div>}
      {err && <div className="mt-3 break-all text-xs text-red-400">{err}</div>}

      {token && (
        <>
          <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs font-medium">Add model (inline)</div>
            <div className="mt-2 flex gap-2">
              <input
                className="flex-1 rounded bg-slate-950 p-2 text-xs"
                placeholder="Model name"
                value={newModelName}
                onChange={(e) => setNewModelName(e.target.value)}
              />
              <button className="rounded bg-slate-200 px-3 py-2 text-xs font-medium text-slate-950" onClick={() => void createModelInline()}>
                Create
              </button>
            </div>
          </div>

          <div className="mt-3 rounded border border-slate-800 bg-slate-900/40 p-3">
            <div className="text-xs font-medium">Add printer</div>
            <div className="mt-2 grid gap-2">
              <input
                className="w-full rounded bg-slate-950 p-2 text-xs"
                placeholder="displayName"
                value={newPrinter.displayName}
                onChange={(e) => setNewPrinter((p) => ({ ...p, displayName: e.target.value }))}
              />
              <select
                className="w-full rounded bg-slate-950 p-2 text-xs"
                value={newPrinter.modelId}
                onChange={(e) => setNewPrinter((p) => ({ ...p, modelId: e.target.value }))}
              >
                <option value="">model...</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              <input
                className="w-full rounded bg-slate-950 p-2 text-xs"
                placeholder="moonrakerBaseUrl (http://...:7125)"
                value={newPrinter.moonrakerBaseUrl}
                onChange={(e) => setNewPrinter((p) => ({ ...p, moonrakerBaseUrl: e.target.value }))}
              />
              <input
                className="w-full rounded bg-slate-950 p-2 text-xs"
                placeholder="moonrakerApiKey"
                value={newPrinter.moonrakerApiKey}
                onChange={(e) => setNewPrinter((p) => ({ ...p, moonrakerApiKey: e.target.value }))}
              />
              <div className="text-xs text-slate-400">apiKey will not be displayed after save.</div>
              <button
                className="w-full rounded bg-slate-200 px-3 py-2 text-xs font-medium text-slate-950"
                onClick={() => void createPrinter()}
              >
                Create
              </button>
            </div>
          </div>

          <div className="mt-3 space-y-3">
            {printers.map((p) => (
              <div key={p.id} className="rounded border border-slate-800 bg-slate-900/40 p-3">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-sm font-medium">{p.displayName}</div>
                    <div className="text-xs text-slate-400">{p.modelName}</div>
                  </div>
                  <div className="text-xs text-slate-400">{p.id.slice(0, 8)}</div>
                </div>

                <div className="mt-2 text-xs text-slate-300">
                  <div className="text-slate-400">rekey</div>
                  <div>{p.needsRekey ? 'needsRekey=true' : 'ok'}</div>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-2">
                  <button className="rounded bg-slate-950 px-2 py-2 text-xs" onClick={() => void testPrinter(p.id)}>
                    Test
                  </button>
                  <button className="rounded bg-slate-950 px-2 py-2 text-xs" onClick={() => void rescanPrinter(p.id)}>
                    Rescan
                  </button>
                  <button className="rounded bg-red-950/40 px-2 py-2 text-xs" onClick={() => void removePrinter(p.id)}>
                    Remove
                  </button>
                </div>

                {devOnly && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <button className="rounded bg-slate-950 px-2 py-2 text-xs" onClick={() => void pausePrinter(p.id)}>
                      Pause
                    </button>
                    <button className="rounded bg-slate-950 px-2 py-2 text-xs" onClick={() => void resumePrinter(p.id)}>
                      Resume
                    </button>
                    <button className="rounded bg-red-950/40 px-2 py-2 text-xs" onClick={() => void cancelPrinter(p.id)}>
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
            {printers.length === 0 && <div className="text-xs text-slate-400">No printers.</div>}
          </div>
        </>
      )}
    </AppShell>
  );
}
