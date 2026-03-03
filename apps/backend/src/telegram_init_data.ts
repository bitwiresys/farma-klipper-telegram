import crypto from 'node:crypto';

export type TelegramUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TelegramInitDataParsed = {
  authDate: number;
  user: TelegramUser;
  raw: Record<string, string>;
};

function timingSafeEqualHex(aHex: string, bHex: string): boolean {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function parseTelegramInitData(
  initData: string,
): Record<string, string> {
  const params = new URLSearchParams(initData);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) out[k] = v;
  return out;
}

export function validateTelegramInitData(opts: {
  initData: string;
  botToken: string;
  maxAgeSec: number;
  nowSec?: number;
}): TelegramInitDataParsed {
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);

  const data = parseTelegramInitData(opts.initData);
  const hash = data.hash;
  if (!hash) throw new Error('initData missing hash');

  const pairs: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (k === 'hash') continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto
    .createHmac('sha256', 'WebAppData')
    .update(opts.botToken)
    .digest();
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex');

  if (!timingSafeEqualHex(computedHash, hash)) {
    throw new Error('initData hash mismatch');
  }

  const authDateRaw = data.auth_date;
  if (!authDateRaw) throw new Error('initData missing auth_date');
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate) || authDate <= 0)
    throw new Error('initData invalid auth_date');

  if (nowSec - authDate > opts.maxAgeSec) {
    throw new Error('initData expired');
  }

  const userRaw = data.user;
  if (!userRaw) throw new Error('initData missing user');

  let user: TelegramUser;
  try {
    user = JSON.parse(userRaw) as TelegramUser;
  } catch {
    throw new Error('initData invalid user JSON');
  }

  if (!user?.id || !Number.isFinite(user.id))
    throw new Error('initData invalid user.id');

  return { authDate, user, raw: data };
}
