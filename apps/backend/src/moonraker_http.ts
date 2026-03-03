import { logger } from './logger.js';
import { env } from './env.js';

export type MoonrakerHttpOptions = {
  baseUrl: string;
  apiKey: string;
};

export type MoonrakerRequestInit = {
  timeoutMs?: number;
};

export type MoonrakerUploadOptions = {
  filename: string;
  data: Buffer;
  path?: string;
  root?: 'gcodes' | 'config';
  checksumSha256?: string;
};

function normalizeBaseUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, '');
  return url;
}

async function fetchJson<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<T> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);

  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Moonraker HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`,
      );
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

  private headersAuthOnly(): HeadersInit {
    return {
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

  async post<T>(
    path: string,
    body?: unknown,
    init?: MoonrakerRequestInit,
  ): Promise<T> {
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

  async queryObjects<T = unknown>(
    objects: string[],
    init?: MoonrakerRequestInit,
  ): Promise<T> {
    return this.post<T>(
      '/printer/objects/query',
      {
        objects: Object.fromEntries(objects.map((o) => [o, null])),
      },
      init,
    );
  }

  async uploadFile<T = any>(
    opts: MoonrakerUploadOptions,
    init?: MoonrakerRequestInit,
  ): Promise<T> {
    const url = `${this.baseUrl}/server/files/upload`;
    logger.debug({ url }, 'moonraker http upload');

    const form = new FormData();

    // Moonraker expects field name: file
    const blob = new Blob([new Uint8Array(opts.data)], {
      type: 'application/octet-stream',
    });
    form.append('file', blob, opts.filename);

    if (opts.root) form.append('root', opts.root);
    if (opts.path) form.append('path', opts.path);
    if (opts.checksumSha256) form.append('checksum', opts.checksumSha256);

    return fetchJson<T>(
      url,
      {
        method: 'POST',
        headers: this.headersAuthOnly(),
        body: form as any,
      },
      init?.timeoutMs ?? 30_000,
    );
  }
}
