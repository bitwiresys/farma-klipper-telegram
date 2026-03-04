'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { CreatePresetSchema } from '../../lib/schemas';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../auth/auth_context';
import { apiRequest, tryParseApiErrorBody, type ApiError } from '../../lib/api';
import type { PresetDto } from '../../lib/dto';

type FieldErrors = Record<string, string[]>;

function normalizeFieldErrors(raw: unknown): FieldErrors {
  const obj = raw as any;
  const fe = obj?.details?.fieldErrors;
  if (!fe || typeof fe !== 'object') return {};
  return fe as FieldErrors;
}

export default function NewPresetPage() {
  const { token } = useAuth();
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);
  const [printers, setPrinters] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [history, setHistory] = useState<
    Array<{ printerId: string; filename: string }>
  >([]);

  const [sourcePrinterId, setSourcePrinterId] = useState<string>('');
  const [sourceFilename, setSourceFilename] = useState<string>('');
  const [title, setTitle] = useState('');
  const [plasticType, setPlasticType] = useState('PLA');
  const [colorHex, setColorHex] = useState('#ffffff');
  const [description, setDescription] = useState<string>('');

  const [allowedModelIds, setAllowedModelIds] = useState<string[]>([]);

  const loadModels = async () => {
    if (!token) return;
    const res = await apiRequest<{
      models: Array<{ id: string; name: string }>;
    }>('/api/printer-models', { token });
    setModels(res.models);
  };

  const loadHistory = async () => {
    if (!token) return;
    const res = await apiRequest<{
      history: Array<{ printerId: string; filename: string }>;
    }>('/api/history?limit=200', { token });
    const items = Array.isArray(res.history) ? res.history : [];
    setHistory(
      items
        .map((x) => ({
          printerId: String(x.printerId),
          filename: String(x.filename),
        }))
        .filter((x) =>
          Boolean(x.printerId && x.filename && x.filename !== 'unknown'),
        ),
    );
  };

  const loadPrinters = async () => {
    if (!token) return;
    const res = await apiRequest<{
      printers: Array<{ id: string; displayName: string }>;
    }>('/api/printers', { token });
    setPrinters(
      (res.printers ?? []).map((p) => ({
        id: String(p.id),
        displayName: String(p.displayName),
      })),
    );
  };

  useEffect(() => {
    void loadModels();
    void loadHistory();
    void loadPrinters();
  }, [token]);

  const toggleModel = (id: string) => {
    setAllowedModelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!token) return;
    setErr(null);
    setFieldErrors({});

    if (!sourcePrinterId || !sourceFilename) {
      setErr('Select gcode from history');
      return;
    }

    const data = {
      title,
      plasticType,
      colorHex,
      description: description ? description : null,
      sourcePrinterId,
      sourceFilename,
      compatibilityRules: {
        allowedModelIds,
      },
    };

    const parsed = CreatePresetSchema.safeParse(data);
    if (!parsed.success) {
      setErr('Form validation failed');
      setFieldErrors(parsed.error.flatten().fieldErrors as any);
      return;
    }

    try {
      setSaving(true);
      const res = await apiRequest<{ preset: PresetDto }>('/api/presets', {
        token,
        method: 'POST',
        body: parsed.data,
      });
      window.location.href = `/presets/${res.preset.id}`;
    } catch (e) {
      const ae = e as ApiError;
      const parsedBody = tryParseApiErrorBody(ae.bodyText);
      setFieldErrors(normalizeFieldErrors(parsedBody));
      setErr(
        typeof parsedBody === 'object' && parsedBody
          ? JSON.stringify(parsedBody)
          : ae.bodyText,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div className="text-xs text-textSecondary">Add preset</div>
        <Link href="/presets">
          <Button variant="ghost">Cancel</Button>
        </Link>
      </div>

      {!token && (
        <div className="mt-3 text-xs text-slate-400">Login required.</div>
      )}

      {token && (
        <div className="mt-3 space-y-3">
          {err && <div className="break-all text-xs text-red-400">{err}</div>}

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">
              Choose gcode from history
            </div>
            <div className="mt-2 grid gap-2">
              <select
                className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                value={sourcePrinterId}
                onChange={(e) => {
                  setSourcePrinterId(e.target.value);
                  setSourceFilename('');
                }}
              >
                <option value="">Printer…</option>
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>

              <select
                className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                value={sourceFilename}
                onChange={(e) => setSourceFilename(e.target.value)}
                disabled={!sourcePrinterId}
              >
                <option value="">Gcode file…</option>
                {history
                  .filter((h) => h.printerId === sourcePrinterId)
                  .map((h) => h.filename)
                  .filter((x, i, a) => a.indexOf(x) === i)
                  .slice(0, 200)
                  .map((fn) => (
                    <option key={fn} value={fn}>
                      {fn}
                    </option>
                  ))}
              </select>

              <div className="text-xs text-textMuted">
                Files are taken from Moonraker history.
              </div>
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">Info</div>
            <div className="mt-2 grid gap-2">
              <input
                className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                placeholder="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {fieldErrors.title && (
                <div className="text-xs text-red-400">
                  {fieldErrors.title.join(', ')}
                </div>
              )}

              <input
                className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                placeholder="Plastic type"
                value={plasticType}
                onChange={(e) => setPlasticType(e.target.value)}
              />
              {fieldErrors.plasticType && (
                <div className="text-xs text-red-400">
                  {fieldErrors.plasticType.join(', ')}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  placeholder="#ffffff"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                />
                <input
                  className="h-10 w-12 rounded-btn border border-border/45 bg-surface2/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  type="color"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                />
              </div>
              {fieldErrors.colorHex && (
                <div className="text-xs text-red-400">
                  {fieldErrors.colorHex.join(', ')}
                </div>
              )}

              <textarea
                className="w-full rounded-btn border border-border/45 bg-surface2/55 p-3 text-xs text-textPrimary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                placeholder="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
              {fieldErrors.description && (
                <div className="text-xs text-red-400">
                  {fieldErrors.description.join(', ')}
                </div>
              )}
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">
              Compatibility
            </div>

            <div className="mt-3 text-xs text-textSecondary">
              Allowed models
            </div>
            <div className="mt-2 grid gap-2">
              {models.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={allowedModelIds.includes(m.id)}
                    onChange={() => toggleModel(m.id)}
                  />
                  <span className="text-textPrimary">{m.name}</span>
                </label>
              ))}
              {models.length === 0 && (
                <div className="text-xs text-textSecondary">
                  No models yet. Create models in Printers tab.
                </div>
              )}
            </div>
          </Card>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <Button
              variant="secondary"
              onClick={() => window.history.back()}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button
              className="w-full"
              variant="primary"
              onClick={() => void submit()}
              disabled={!token || saving}
            >
              {saving ? 'Saving…' : 'Save preset'}
            </Button>
          </div>

          <div className="text-xs text-textMuted">
            Thumbnail & metadata are fetched from Moonraker immediately after
            save.
          </div>
        </div>
      )}
    </>
  );
}
