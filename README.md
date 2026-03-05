# Farma

Telegram Mini App + backend for managing Klipper/Moonraker printers:

- Presets library (`.gcode` upload + metadata + thumbnail)
- One-tap print start on selected printers
- Realtime status via WebSocket
- Print history with thumbnails
- Telegram notifications (first layer / complete / error)

## Prerequisites

- Node.js + pnpm
- A Moonraker instance per printer (Klipper)
- Telegram Bot token (BotFather)
- SQLite (bundled via Prisma)

## Install

```bash
pnpm install
```

## Environment variables

This repo has two apps:

- `apps/backend` (Fastify + Prisma)
- `apps/frontend` (Next.js mini app)

Create env files:

- `apps/backend/.env`
- `apps/frontend/.env.local`

### Backend env (`apps/backend/.env`)

Required:

- `JWT_SECRET`
  - any random string, **min 16 chars**
- `TELEGRAM_BOT_TOKEN`
  - token from BotFather
- `TELEGRAM_WEBAPP_URL`
  - public HTTPS URL of the mini app (Telegram requires HTTPS)
- `PRINTER_API_KEY_ENC_KEY`
  - any random string, **min 16 chars** (used to encrypt Moonraker API keys in DB)

Common / defaults:

- `PORT=3001`
- `BASE_URL_PUBLIC=http://localhost:3001`
- `DATABASE_URL=file:./dev.db`
- `FILES_DIR=./data`
- `CORS_ORIGIN=*`

Optional:

- `TELEGRAM_ALLOWED_USER_IDS`
  - comma separated Telegram numeric user IDs
  - when set, only these users can use the app (can still be allowed from UI)

Example:

```env
NODE_ENV=development
PORT=3001
BASE_URL_PUBLIC=http://localhost:3001

TELEGRAM_WEBAPP_URL=https://YOUR_PUBLIC_URL
TELEGRAM_ALLOWED_USER_IDS=
TELEGRAM_AUTH_MAX_AGE_SEC=86400

DATABASE_URL=file:./dev.db
FILES_DIR=./data
WS_BATCH_INTERVAL_MS=400

RATE_LIMIT_RPM=120
CORS_ORIGIN=*
```

Add secrets (do not commit them):

- `JWT_SECRET`: random string, min 16 chars
- `TELEGRAM_BOT_TOKEN`: token from BotFather
- `PRINTER_API_KEY_ENC_KEY`: random string, min 16 chars

### Frontend env (`apps/frontend/.env.local`)

Required:

- `NEXT_PUBLIC_BACKEND_BASE_URL`
  - backend HTTP base url
- `NEXT_PUBLIC_BACKEND_WS_URL`
  - backend WS base url (usually same host as HTTP)

Examples:

```env
NEXT_PUBLIC_BACKEND_BASE_URL=http://localhost:3001
NEXT_PUBLIC_BACKEND_WS_URL=ws://localhost:3001
```

## Database (Prisma)

Run migrations (or create DB) from repo root:

```bash
pnpm --filter @farma/backend prisma migrate deploy
```

For local dev you can also use:

```bash
pnpm --filter @farma/backend prisma migrate dev
```

## Run (development)

Two terminals:

```bash
pnpm --filter @farma/backend dev
```

```bash
pnpm --filter @farma/frontend dev
```

Backend health:

- `GET /api/health`

## Telegram setup

1. Create a bot with BotFather and set `TELEGRAM_BOT_TOKEN`.

2. Set the Mini App URL:

- `TELEGRAM_WEBAPP_URL=https://...` (must be HTTPS and publicly reachable)

3. Start the bot in Telegram:

- send `/start`
- the backend will upsert your user (`telegramId`, `chatId`)

4. Allow user:

- open `/security` in the app (admin)
- or set `TELEGRAM_ALLOWED_USER_IDS`

## Moonraker printer setup

In the UI:

1. Create a printer model
2. Add a printer
   - `baseUrl`: `http://<moonraker-host>:7125` (example)
   - `apiKey`: Moonraker API key (if enabled)

The backend encrypts the API key in DB using `PRINTER_API_KEY_ENC_KEY`.

## Troubleshooting

- If thumbnails do not load in the mini app:
  - ensure `NEXT_PUBLIC_BACKEND_BASE_URL` points to the backend
  - ensure the backend is reachable from Telegram webview

- If WS reconnect loops:
  - check `NEXT_PUBLIC_BACKEND_WS_URL`
  - check backend logs for auth errors

- If notifications are not sent:
  - ensure you pressed `/start` in Telegram
  - check `/api/notifications/diagnostics`
