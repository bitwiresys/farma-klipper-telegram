# Assumptions

- DB provider: остаёмся на SQLite (Prisma datasource provider = sqlite). Переключение на Postgres будет делаться отдельно, не ломая SQLite.
- Preset.allowedNozzleDiameters: храним как JSON-массив чисел (SQLite), далее на сервисном слое валидируем как number[].
- Preset.gcodeMeta: храним как JSON (SQLite), структура будет уточняться на этапе Moonraker metascan/metadata.
- PrintHistory.status / NotificationLog.eventType: храним как строки. Позже можем заменить на enum в Prisma, когда стабилизируется список.
- User.chatId: в Telegram Mini App initData не содержит chat_id, поэтому пока оставляем null; будет заполняться позже через bot updates.
- User.isAllowed: если TELEGRAM_ALLOWED_USER_IDS пустой, считаем allow-all для dev; иначе строго whitelist.
