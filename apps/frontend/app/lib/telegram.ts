export function getTelegramInitData(): string {
  const tg = (globalThis as any)?.Telegram?.WebApp;
  const initData = typeof tg?.initData === 'string' ? tg.initData : '';
  return initData;
}

export function isTelegramWebApp(): boolean {
  return Boolean((globalThis as any)?.Telegram?.WebApp);
}

export async function waitForTelegramWebApp(timeoutMs = 2500): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (isTelegramWebApp()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return isTelegramWebApp();
}

export function telegramReady(): void {
  const tg = (globalThis as any)?.Telegram?.WebApp;
  try {
    tg?.ready?.();
  } catch {
    return;
  }
}
