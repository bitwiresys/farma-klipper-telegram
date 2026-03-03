'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../auth/auth_context';
import { apiRequest, tryParseApiErrorBody, type ApiError } from '../../lib/api';

type ModelDto = { id: string; name: string };

export default function NewPrinterPage() {
  const { token } = useAuth();

  const [err, setErr] = useState<string | null>(null);
  const [models, setModels] = useState<ModelDto[]>([]);

  const [displayName, setDisplayName] = useState('');
  const [modelId, setModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [moonrakerBaseUrl, setMoonrakerBaseUrl] = useState('');
  const [moonrakerApiKey, setMoonrakerApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);

  const loadModels = async () => {
    if (!token) return;
    const m = await apiRequest<{ models: ModelDto[] }>('/api/printer-models', {
      token,
    });
    setModels(m.models);
  };

  useEffect(() => {
    void loadModels();
  }, [token]);

  const canSave = useMemo(() => {
    return Boolean(
      displayName.trim() &&
      modelId.trim() &&
      moonrakerBaseUrl.trim() &&
      moonrakerApiKey.trim(),
    );
  }, [displayName, modelId, moonrakerBaseUrl, moonrakerApiKey]);

  const createModel = async () => {
    if (!token) return;
    setErr(null);
    const name = newModelName.trim();
    if (!name) return;
    await apiRequest('/api/printer-models', {
      token,
      method: 'POST',
      body: { name },
    });
    setNewModelName('');
    await loadModels();
  };

  const save = async () => {
    if (!token) return;
    if (!canSave) return;
    setErr(null);

    try {
      const res = await apiRequest<{ printer: { id: string } }>(
        '/api/printers',
        {
          token,
          method: 'POST',
          body: {
            displayName: displayName.trim(),
            modelId,
            moonrakerBaseUrl: moonrakerBaseUrl.trim(),
            moonrakerApiKey: moonrakerApiKey.trim(),
          },
        },
      );
      window.location.href = `/printers/${res.printer.id}`;
    } catch (e) {
      const ae = e as ApiError;
      const parsed = tryParseApiErrorBody(ae.bodyText);
      setErr(
        typeof parsed === 'object' && parsed
          ? JSON.stringify(parsed)
          : ae.bodyText,
      );
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Add printer</div>
        <Link href="/printers">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-textSecondary">Login required.</div>
      )}
      {token && err && (
        <div className="mt-3 break-all text-xs text-red-400">{err}</div>
      )}

      {token && (
        <div className="mt-3 space-y-3">
          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">Info</div>
            <div className="mt-2 grid gap-2">
              <input
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                placeholder="Display name"
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                }}
              />

              <select
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              >
                <option value="">Model…</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                  placeholder="Create new model…"
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                />
                <Button
                  variant="secondary"
                  onClick={() => void createModel()}
                  disabled={!newModelName.trim()}
                >
                  Create
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">
              Connection
            </div>
            <div className="mt-2 grid gap-2">
              <input
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                placeholder="Moonraker URL (http://...:7125)"
                value={moonrakerBaseUrl}
                onChange={(e) => {
                  setMoonrakerBaseUrl(e.target.value);
                }}
              />

              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                  placeholder="API Key"
                  type={showKey ? 'text' : 'password'}
                  value={moonrakerApiKey}
                  onChange={(e) => {
                    setMoonrakerApiKey(e.target.value);
                  }}
                />
                <Button
                  variant="secondary"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? 'Hide' : 'Show'}
                </Button>
              </div>

              <div className="text-xs text-textMuted">
                API key will not be displayed after save.
              </div>
            </div>
          </Card>

          <Button
            className="w-full"
            variant="primary"
            onClick={() => void save()}
            disabled={!canSave}
          >
            Save
          </Button>

          <Link href="/printers" className="block">
            <Button className="w-full" variant="ghost">
              Cancel
            </Button>
          </Link>
        </div>
      )}
    </>
  );
}
