# Assumptions

- DB provider: остаёмся на SQLite (Prisma datasource provider = sqlite). Переключение на Postgres будет делаться отдельно, не ломая SQLite.
- Prisma provider (sqlite/postgresql) не переключается "только env-ом" в одном schema. Поэтому сейчас поддерживаем только SQLite; Postgres — отдельная реализация/ветка.
- Preset.allowedNozzleDiameters: храним как JSON-массив чисел (SQLite), далее на сервисном слое валидируем как number[].
- Preset.gcodeMeta: храним как JSON (SQLite), структура будет уточняться на этапе Moonraker metascan/metadata.
- PrintHistory.status / NotificationLog.eventType: храним как строки. Позже можем заменить на enum в Prisma, когда стабилизируется список.
- User.chatId: в Telegram Mini App initData не содержит chat_id, поэтому пока оставляем null; будет заполняться позже через bot updates.
- User.isAllowed: если TELEGRAM_ALLOWED_USER_IDS пустой, считаем allow-all для dev; иначе строго whitelist.

- Telegram Mini App initData validation: используем официальный алгоритм Telegram "Validating data received via the Mini App":
  - secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
  - hash = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))

- Moonraker WS auth: выбираем стабильный путь A) WS handshake с заголовком `X-Api-Key`, если библиотека позволяет; если на практике заголовки в WS недоступны/не работают, fallback B) connect -> `server.connection.identify(api_key=...)` с логированием `authenticated=true/false`.

- CI/TypeScript: `apps/backend` typecheck выполняется через отдельный `tsconfig.typecheck.json`, который маппит `@farma/shared` на `packages/shared/src` (чтобы typecheck не зависел от наличия `packages/shared/dist` в чистом CI).

- Frontend build (Vercel): сборка `apps/frontend` происходит в изоляции и не гарантирует доступ к workspace-пакету `@farma/shared`. Поэтому shared-DTO/compatibility helpers, нужные для UI, дублируются в `apps/frontend/app/lib/*`.
