import { getBackendBaseUrl } from './env';

export type ApiError = {
  status: number;
  bodyText: string;
};

async function readBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export async function apiRequest<T>(
  path: string,
  opts: { token?: string; method?: string; body?: unknown } = {},
): Promise<T> {
  const base = getBackendBaseUrl();
  if (!base) throw new Error('NEXT_PUBLIC_BACKEND_BASE_URL is not set');

  const url = `${base}${path}`;

  const headers: Record<string, string> = {};

  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const hasBody = opts.body !== undefined;
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
  });

  if (!res.ok) {
    const bodyText = await readBodyText(res);
    const err: ApiError = { status: res.status, bodyText };
    throw err;
  }

  const text = await readBodyText(res);
  return (text ? JSON.parse(text) : {}) as T;
}
