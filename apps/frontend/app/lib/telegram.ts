export function getTelegramInitData(): string {
  const tg = (globalThis as any)?.Telegram?.WebApp;
  const initData = typeof tg?.initData === 'string' ? tg.initData : '';
  return initData;
}

export function isTelegramWebApp(): boolean {
  return Boolean((globalThis as any)?.Telegram?.WebApp);
}
