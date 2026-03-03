export function getBackendBaseUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BACKEND_BASE_URL ?? '';
  return raw.replace(/\/$/, '');
}

export function getBackendWsUrl(): string {
  const raw = process.env.NEXT_PUBLIC_BACKEND_WS_URL ?? '';
  return raw.replace(/\/$/, '');
}
