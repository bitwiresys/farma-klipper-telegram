'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

import { CreatePresetSchema } from '../../lib/schemas';

import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { useAuth } from '../../auth/auth_context';
import {
  apiRequest,
  apiRequestForm,
  tryParseApiErrorBody,
  type ApiError,
} from '../../lib/api';
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

  const [filePickerId] = useState(
    () => `file_${Math.random().toString(16).slice(2)}`,
  );

  const [models, setModels] = useState<Array<{ id: string; name: string }>>([]);

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [plasticType, setPlasticType] = useState('PLA');
  const [colorHex, setColorHex] = useState('#ffffff');
  const [description, setDescription] = useState<string>('');

  const [allowedModelIds, setAllowedModelIds] = useState<string[]>([]);
  const [allowedNozzleDiameters, setAllowedNozzleDiameters] = useState<
    number[]
  >([0.4]);
  const [customNozzle, setCustomNozzle] = useState<string>('');
  const [minBedX, setMinBedX] = useState<number>(10);
  const [minBedY, setMinBedY] = useState<number>(10);

  const loadModels = async () => {
    if (!token) return;
    const res = await apiRequest<{
      models: Array<{ id: string; name: string }>;
    }>('/api/printer-models', { token });
    setModels(res.models);
  };

  useEffect(() => {
    void loadModels();
  }, [token]);

  const toggleModel = (id: string) => {
    setAllowedModelIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleNozzle = (v: number) => {
    setAllowedNozzleDiameters((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );
  };

  const addCustomNozzle = () => {
    const n = Number(customNozzle);
    if (!Number.isFinite(n) || n <= 0) return;
    setAllowedNozzleDiameters((prev) =>
      prev.includes(n) ? prev : [...prev, n],
    );
    setCustomNozzle('');
  };

  const sortedNozzles = useMemo(() => {
    return [...allowedNozzleDiameters].sort((a, b) => a - b);
  }, [allowedNozzleDiameters]);

  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!token) return;
    setErr(null);
    setFieldErrors({});

    if (!file) {
      setErr('Select .gcode file');
      return;
    }

    const data = {
      title,
      plasticType,
      colorHex,
      description: description ? description : null,
      compatibilityRules: {
        allowedModelIds,
        allowedNozzleDiameters: sortedNozzles,
        minBedX,
        minBedY,
      },
    };

    const parsed = CreatePresetSchema.safeParse(data);
    if (!parsed.success) {
      setErr('Form validation failed');
      setFieldErrors(parsed.error.flatten().fieldErrors as any);
      return;
    }

    const form = new FormData();
    form.append('gcode', file, file.name);
    form.append('data', JSON.stringify(parsed.data));

    try {
      setSaving(true);
      const res = await apiRequestForm<{ preset: PresetDto }>('/api/presets', {
        token,
        form,
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
              Upload gcode
            </div>
            <div className="mt-2 rounded-card border border-border/70 bg-surface2 p-3">
              <div className="text-xs text-textSecondary">
                {file ? file.name : 'No file selected'}
              </div>
              <div className="mt-3">
                <label htmlFor={filePickerId} className="block">
                  <Button className="w-full" variant="primary">
                    Choose file (.gcode)
                  </Button>
                </label>
                <input
                  id={filePickerId}
                  className="hidden"
                  type="file"
                  accept=".gcode"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>
          </Card>

          <Card className="p-3">
            <div className="text-xs font-medium text-textPrimary">Info</div>
            <div className="mt-2 grid gap-2">
              <input
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
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
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
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
                  className="flex-1 rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                  placeholder="#ffffff"
                  value={colorHex}
                  onChange={(e) => setColorHex(e.target.value)}
                />
                <input
                  className="h-10 w-12 rounded-btn border border-border/70 bg-surface2"
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
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
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

            <div className="mt-3 text-xs text-textSecondary">
              Allowed nozzle
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {[0.2, 0.4, 0.6, 0.8].map((n) => (
                <button
                  key={n}
                  className={
                    'rounded-btn border border-border/70 px-3 py-2 text-xs ' +
                    (allowedNozzleDiameters.includes(n)
                      ? 'bg-accentCyan/10 text-accentCyan'
                      : 'bg-surface2 text-textSecondary')
                  }
                  onClick={() => toggleNozzle(n)}
                  type="button"
                >
                  {n}
                </button>
              ))}
            </div>

            <div className="mt-3 flex gap-2">
              <input
                className="flex-1 rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                placeholder="custom nozzle (e.g. 0.5)"
                value={customNozzle}
                onChange={(e) => setCustomNozzle(e.target.value)}
              />
              <Button variant="secondary" onClick={() => addCustomNozzle()}>
                Add
              </Button>
            </div>
            {fieldErrors['compatibilityRules.allowedNozzleDiameters'] && (
              <div className="text-xs text-red-400">
                {fieldErrors['compatibilityRules.allowedNozzleDiameters'].join(
                  ', ',
                )}
              </div>
            )}

            <div className="mt-3 text-xs text-textSecondary">Min bed size</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                placeholder="minBedX"
                value={minBedX}
                type="number"
                onChange={(e) => setMinBedX(Number(e.target.value))}
              />
              <input
                className="w-full rounded-btn border border-border/70 bg-surface2 p-3 text-xs"
                placeholder="minBedY"
                value={minBedY}
                type="number"
                onChange={(e) => setMinBedY(Number(e.target.value))}
              />
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
            Thumbnail & metadata may appear after first deploy.
          </div>
        </div>
      )}
    </>
  );
}
