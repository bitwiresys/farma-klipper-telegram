import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  BASE_URL_PUBLIC: z.string().url().default('http://localhost:3001'),
  BACKEND_URL: z.string().url().optional(),

  JWT_SECRET: z.string().min(16),

  TELEGRAM_BOT_TOKEN: z.string().min(10),
  TELEGRAM_WEBAPP_URL: z.string().url(),
  TELEGRAM_ALLOWED_USER_IDS: z.string().default(''),
  TELEGRAM_AUTH_MAX_AGE_SEC: z.coerce.number().int().positive().default(86400),

  PRINTER_API_KEY_ENC_KEY: z.string().min(16),

  DATABASE_URL: z.string().default('file:./dev.db'),

  FILES_DIR: z.string().default('./data'),
  WS_BATCH_INTERVAL_MS: z.coerce.number().int().positive().default(400),

  RATE_LIMIT_RPM: z.coerce.number().int().positive().default(120),
  CORS_ORIGIN: z.string().default('*'),

  // Web Push VAPID keys (generate with: npx web-push generate-vapid-keys)
  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

export const env: Env = schema.parse(process.env);

export function getAllowedTelegramUserIds(): Set<number> {
  const raw = env.TELEGRAM_ALLOWED_USER_IDS.trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => Number(x))
      .filter((x) => Number.isSafeInteger(x) && x > 0),
  );
}
