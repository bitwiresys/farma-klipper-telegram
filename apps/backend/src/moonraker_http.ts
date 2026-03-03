import { logger } from './logger.js';
import { env } from './env.js';

export type MoonrakerHttpOptions = {
  baseUrl: string;
  apiKey: string;
};

export type MoonrakerRequestInit = {
  timeoutMs?: number;
};

function normalizeBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  return url;
}

async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Moonraker HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
    }
    return text ? (JSON.parse(text) as T) : ({} as T);
  } finally {
    clearTimeout(t);
  }
}

export class MoonrakerHttp {
  private baseUrl: string;
  private apiKey: string;

  constructor(opts: MoonrakerHttpOptions) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    if (!opts.apiKey.trim()) {
      throw new Error('Moonraker apiKey is required');
    }
    this.apiKey = opts.apiKey;
  }

  private headers(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'X-Api-Key': this.apiKey,
    };
  }

  async get<T>(path: string, init?: MoonrakerRequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug({ url }, 'moonraker http get');
    return fetchJson<T>(
      url,
      {
        method: 'GET',
        headers: this.headers(),
      },
      init?.timeoutMs ?? 8000,
    );
  }

  async post<T>(path: string, body?: unknown, init?: MoonrakerRequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    logger.debug({ url }, 'moonraker http post');
    return fetchJson<T>(
      url,
      {
        method: 'POST',
        headers: this.headers(),
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      init?.timeoutMs ?? 8000,
    );
  }

  async queryObjects<T = unknown>(objects: string[], init?: MoonrakerRequestInit): Promise<T> {
    return this.post<T>(
      '/printer/objects/query',
      {
        objects: Object.fromEntries(objects.map((o) => [o, null])),
      },
      init,
    );
  }
}
