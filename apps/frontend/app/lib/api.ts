import { getBackendBaseUrl } from './env';

export type ApiError = {
  status: number;
  bodyText: string;
};

export function tryParseApiErrorBody(bodyText: string): unknown {
  try {
    return JSON.parse(bodyText);
  } catch {
    return null;
  }
}

async function readBodyText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

export async function apiRequestForm<T>(
  path: string,
  opts: { token?: string; method?: string; form: FormData },
): Promise<T> {
  const base = getBackendBaseUrl();
  if (!base) throw new Error('NEXT_PUBLIC_BACKEND_BASE_URL is not set');

  const url = `${base}${path}`;

  const headers: Record<string, string> = {};
  if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }

  const res = await fetch(url, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.form,
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

  const method = (opts.method ?? 'GET').toUpperCase();
  const wantsJsonBody =
    method === 'POST' ||
    method === 'PUT' ||
    method === 'PATCH' ||
    method === 'DELETE';
  const hasBody = opts.body !== undefined;
  const bodyObj = hasBody ? opts.body : wantsJsonBody ? {} : undefined;
  const willSendBody = bodyObj !== undefined;
  if (willSendBody) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method: opts.method ?? 'GET',
    headers,
    body: willSendBody ? JSON.stringify(bodyObj) : undefined,
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
