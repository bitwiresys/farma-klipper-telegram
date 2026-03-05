# Farma Project Architecture

## Overview

Farma - Telegram Mini App для управления 3D принтерами через Moonraker API. Позволяет мониторить статус печати, запускать пресеты на нескольких принтерах одновременно, получать уведомления о событиях печати.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              TELEGRAM ECOSYSTEM                              │
│  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────────────┐│
│  │  Telegram Bot   │     │ Telegram WebApp │     │   Telegram Bot API      ││
│  │  (commands)     │     │   (Frontend)    │     │   (messages/updates)    ││
│  └────────┬────────┘     └────────┬────────┘     └────────────┬────────────┘│
└───────────┼───────────────────────┼───────────────────────────┼─────────────┘
            │                       │                           │
            │                       │ HTTP/WebSocket            │ Webhook
            │                       ▼                           │
            │    ┌──────────────────────────────────────────────┴───────────┐
            │    │                     BACKEND (Node.js)                    │
            │    │  ┌─────────────────────────────────────────────────────┐  │
            │    │  │                   Express Server                    │  │
            │    │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │  │
            │    │  │  │ REST API    │  │ WebSocket   │  │ Telegram    │ │  │
            │    │  │  │ /api/*      │  │ /ws         │  │ Bot Handler │ │  │
            │    │  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │  │
            │    │  └─────────┼────────────────┼────────────────┼────────┘  │
            │    │            │                │                │           │
            │    │  ┌─────────┴────────────────┴────────────────┴────────┐  │
            │    │  │                   Services Layer                  │  │
            │    │  │  ┌─────────────────┐  ┌─────────────────────────┐  │  │
            │    │  │  │ PrinterRuntime  │  │ NotificationService     │  │  │
            │    │  │  │ Manager         │  │                         │  │  │
            │    │  │  └────────┬────────┘  └────────────┬────────────┘  │  │
            │    │  │           │                        │               │  │
            │    │  │  ┌────────┴────────┐  ┌───────────┴─────────────┐  │  │
            │    │  │  │ MoonrakerHttp   │  │ PresetMetaService      │  │  │
            │    │  │  │                 │  │ SnapshotCache           │  │  │
            │    │  │  └────────┬────────┘  └─────────────────────────┘  │  │
            │    │  └───────────┼────────────────────────────────────────┘  │
            │    │              │                                           │
            │    │  ┌───────────┴────────────────────────────────────────┐  │
            │    │  │                  Data Layer                        │  │
            │    │  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │  │
            │    │  │  │   Prisma    │  │   SQLite    │  │ Crypto API  │  │  │
            │    │  │  │   ORM      │  │   Database  │  │ Key Encrypt │  │  │
            │    │  │  └─────────────┘  └─────────────┘  └─────────────┘  │  │
            │    │  └────────────────────────────────────────────────────┘  │
            │    └───────────────────────────────────────────────────────────┘
            │                                    │
            │                                    │ HTTP (Moonraker API)
            │                                    ▼
            │              ┌─────────────────────────────────────────────┐
            │              │              MOONRAKER SERVER                 │
            │              │  ┌─────────────┐  ┌─────────────────────────┐│
            │              │  │ REST API    │  │ Klipper/Moonraker       ││
            │              │  │ :7125       │  │ Printer Control         ││
            │              │  └─────────────┘  └─────────────────────────┘│
            │              └─────────────────────────────────────────────┘
            │
            └──────────────────────────────────────────────────────────────
                              (User commands via Telegram)
```

## Data Flow

### 1. Authentication Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Telegram     │     │ Frontend     │     │ Backend      │     │ Telegram     │
│ WebApp SDK   │     │ AuthProvider │     │ Auth API     │     │ Bot API      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │  1. User opens    │                    │                    │
       │     Mini App      │                    │                    │
       │───────────────────>                    │                    │
       │                    │                    │                    │
       │  2. initData      │                    │                    │
       │<───────────────────│                    │                    │
       │                    │                    │                    │
       │                    │  3. POST /api/auth/telegram            │
       │                    │    { initData }    │                    │
       │                    │───────────────────>                    │
       │                    │                    │                    │
       │                    │                    │  4. Verify hash    │
       │                    │                    │     with bot token│
       │                    │                    │────────────────────>
       │                    │                    │                    │
       │                    │                    │  5. Get user info │
       │                    │                    │<────────────────────
       │                    │                    │                    │
       │                    │                    │  6. Create/update │
       │                    │                    │     user in DB    │
       │                    │                    │                    │
       │                    │  7. { token }      │                    │
       │                    │<───────────────────│                    │
       │                    │                    │                    │
       │                    │  8. Store token   │                    │
       │                    │     in localStorage                    │
       │                    │                    │                    │
```

### 2. WebSocket Real-time Updates

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Frontend     │     │ Backend      │     │ Moonraker    │     │ Printer      │
│ WsProvider   │     │ WebSocket    │     │ HTTP API     │     │ Hardware     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │  1. Connect /ws    │                    │                    │
       │    { token }       │                    │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │  2. Subscribe      │                    │                    │
       │    to events       │                    │                    │
       │                    │                    │                    │
       │                    │  3. Poll status   │                    │
       │                    │    (interval)     │                    │
       │                    │───────────────────>│                    │
       │                    │                    │                    │
       │                    │                    │  4. Query printer  │
       │                    │                    │     state          │
       │                    │                    │────────────────────>
       │                    │                    │                    │
       │                    │                    │  5. Printer data   │
       │                    │                    │<────────────────────
       │                    │                    │                    │
       │                    │  6. Printer status│                    │
       │                    │<───────────────────│                    │
       │                    │                    │                    │
       │  7. PRINTERS_SNAPSHOT / PRINTER_STATUS │                    │
       │<───────────────────│                    │                    │
       │                    │                    │                    │
       │  8. Update UI      │                    │                    │
       │                    │                    │                    │
```

### 3. Print Preset Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Frontend     │     │ Backend      │     │ Moonraker    │     │ Notification │
│ PresetsPage  │     │ Preset API   │     │ File API     │     │ Service      │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │                    │
       │  1. Select preset │                    │                    │
       │     & printers     │                    │                    │
       │                    │                    │                    │
       │  2. Check compatibility (frontend)     │                    │
       │     - Model allowed?                    │                    │
       │     - Nozzle allowed?                   │                    │
       │     - Bed size?      │                    │                    │
       │     - Printer state?│                    │                    │
       │                    │                    │                    │
       │  3. POST /api/presets/{id}/print       │                    │
       │    { printerIds }   │                    │                    │
       │───────────────────>│                    │                    │
       │                    │                    │                    │
       │                    │  4. Check compatibility (backend)        │
       │                    │     - Re-validate  │                    │
       │                    │     - Return 409 if blocked            │
       │                    │                    │                    │
       │                    │  5. Upload gcode  │                    │
       │                    │    to Moonraker   │                    │
       │                    │───────────────────>│                    │
       │                    │                    │                    │
       │                    │  6. Start print   │                    │
       │                    │───────────────────>│                    │
       │                    │                    │                    │
       │                    │                    │  7. Print started  │
       │                    │                    │                    │
       │                    │  8. Create print  │                    │
       │                    │     session in DB │                    │
       │                    │                    │                    │
       │  9. Success/Error  │                    │                    │
       │<───────────────────│                    │                    │
       │                    │                    │                    │
       │                    │                    │  10. Print events  │
       │                    │                    │     (layer done,   │
       │                    │                    │      complete,     │
       │                    │                    │      error)        │
       │                    │                    │                    │
       │                    │  11. Status update│                    │
       │                    │<───────────────────│                    │
       │                    │                    │                    │
       │                    │  12. Check notifications enabled       │
       │                    │─────────────────────────────────────────>
       │                    │                    │                    │
       │                    │                    │  13. Send Telegram │
       │                    │                    │      notification  │
       │                    │                    │<────────────────────
       │                    │                    │                    │
```

## Component Relationships

### Backend Services

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PrinterRuntimeManager                              │
│  - CRUD printers                                                            │
│  - Execute actions (pause, resume, cancel, emergency_stop, firmware_restart)│
│  - Encrypt/decrypt API keys                                                 │
│  - Manage printer specs (bed size, nozzle)                                  │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    │ uses
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MoonrakerHttp                                   │
│  - HTTP client for Moonraker API                                            │
│  - GET/POST requests with API key auth                                      │
│  - File upload/download                                                     │
│  - Query printer objects (gcode_move, toolhead, heaters, etc.)              │
│  - Printer actions (pause, resume, cancel, emergency_stop)                  │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           NotificationService                                │
│  - Track print sessions                                                     │
│  - Detect events: FIRST_LAYER_DONE, PRINT_COMPLETE, PRINT_ERROR            │
│  - Send Telegram messages                                                   │
│  - Log notifications (prevent duplicates per session)                       │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    │ uses
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SnapshotCache                                   │
│  - In-memory cache of printer snapshots                                     │
│  - Updated on each status poll                                              │
│  - Used for WebSocket broadcasts                                            │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                            PresetMetaService                                 │
│  - Fetch gcode metadata from Moonraker                                      │
│  - Extract embedded thumbnails from gcode files                             │
│  - Update preset info in database                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Frontend Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                layout.tsx                                    │
│  - Root HTML structure                                                      │
│  - Load Telegram WebApp SDK                                                 │
│  - Wrap with ClientRoot                                                     │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               ClientRoot                                     │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │ AuthProvider                                                         │   │
│  │  - Telegram authentication                                           │   │
│  │  - Token management                                                  │   │
│  │  - Auth phases: booting → authorizing → ready/forbidden/need_restart│   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │ WsProvider                                                   │    │   │
│  │  │  - WebSocket connection management                           │    │   │
│  │  │  - Event subscription system                                 │    │   │
│  │  │  - Auto-reconnect on failure                                 │    │   │
│  │  │  ┌─────────────────────────────────────────────────────┐    │    │   │
│  │  │  │ BootstrapGate                                       │    │    │   │
│  │  │  │  - Block render until auth ready + ws open          │    │    │   │
│  │  │  │  - Show error states (forbidden, need_restart)      │    │    │   │
│  │  │  │  ┌─────────────────────────────────────────────┐    │    │    │   │
│  │  │  │  │ AppShell                                    │    │    │    │   │
│  │  │  │  │  - Navigation tabs                          │    │    │    │   │
│  │  │  │  │  - Header with WS status                    │    │    │    │   │
│  │  │  │  │  - {children}                               │    │    │    │   │
│  │  │  │  └─────────────────────────────────────────────┘    │    │    │   │
│  │  │  └─────────────────────────────────────────────────────┘    │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Page Dependencies

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   Dashboard      │     │    Presets       │     │    Printers      │
│                  │     │                  │     │                  │
│ - Printer list   │     │ - Preset library │     │ - Printer list   │
│ - Live status    │     │ - Select printers│     │ - Add printer    │
│ - Actions:       │     │ - Check compat   │     │ - Edit printer   │
│   pause/resume/  │     │ - Start print    │     │ - Delete printer │
│   cancel/estop   │     │                  │     │                  │
└────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
         │                        │                        │
         │                        │                        │
         ▼                        ▼                        ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                           WebSocket Events                                │
│                                                                          │
│  PRINTERS_SNAPSHOT  - Full printer list on connect                       │
│  PRINTER_STATUS     - Single printer update                              │
│  PRESETS_SNAPSHOT   - Full preset list                                   │
│  PRESET_UPDATED     - Preset changed, request refresh                    │
│  HISTORY_SNAPSHOT   - Print history with pagination                      │
│  HISTORY_EVENT      - New history entry                                  │
│  PRINTER_MODELS_SNAPSHOT - Available printer models                      │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│    History       │     │    Settings      │     │   Presets/New    │
│                  │     │                  │     │                  │
│ - Print history  │     │ - Notifications  │     │ - Select gcode   │
│ - Filter by      │     │ - Security       │     │   from history   │
│   status         │     │ - Backend status │     │ - Set metadata   │
│ - Job details    │     │ - Allowed users  │     │ - Set compat     │
│                  │     │ - WS reconnect   │     │                  │
└──────────────────┘     └──────────────────┘     └──────────────────┘
```

## Database Schema

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│      User       │       │  PrinterModel   │       │    Printer      │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id              │       │ id              │◄──────│ modelId         │
│ telegramId (U)  │       │ name            │       │ displayName     │
│ chatId          │       │ createdAt       │       │ baseUrl (U)     │
│ isAllowed       │       │ updatedAt       │       │ apiKeyEncrypted │
│ notifications*  │       │                 │       │ bedX/Y/Z        │
│ mute*           │       │                 │       │ nozzleDiameter  │
│ firstName       │       │                 │       │ createdAt       │
│ lastName        │       │                 │       │ updatedAt       │
│ username        │       │                 │       │                 │
└─────────────────┘       └────────┬────────┘       └────────┬────────┘
                                   │                         │
                                   │                         │
                                   ▼                         │
┌─────────────────┐       ┌─────────────────┐               │
│PresetAllowedMod│       │     Preset      │               │
├─────────────────┤       ├─────────────────┤               │
│ id              │       │ id              │               │
│ presetId    ────┼──────►│ title           │               │
│ modelId     ────┼───┐   │ plasticType     │               │
│                 │   │   │ colorHex        │               │
└─────────────────┘   │   │ description     │               │
                      │   │ gcodePath       │               │
                      │   │ thumbnailPath   │               │
                      │   │ gcodeMeta (JSON)│               │
                      │   └────────┬────────┘               │
                      │            │                        │
                      │            ▼                        │
                      │   ┌─────────────────┐               │
                      │   │PresetCompatRules│               │
                      │   ├─────────────────┤               │
                      │   │ id              │               │
                      │   │ presetId (U)    │               │
                      │   │ minBedX/Y       │               │
                      │   │ allowedNozzle   │               │
                      │   │   Diameters(JSON)              │
                      │   └─────────────────┘               │
                      │                                     │
                      │   ┌─────────────────┐               │
                      │   │PresetDeployment │               │
                      │   ├─────────────────┤               │
                      │   │ id              │               │
                      │   │ presetId    ────┼───┐           │
                      └──►│ printerId   ────┼───┼───────────┘
                          │ remoteFilename  │   │
                          │ checksumSha256  │   │
                          │ uploadedAt      │   │
                          └─────────────────┘   │
                                                │
┌─────────────────┐       ┌─────────────────┐   │
│ NotificationLog │       │  PrintHistory   │   │
├─────────────────┤       ├─────────────────┤   │
│ id              │       │ id              │   │
│ printerId   ────┼──────►│ printerId   ────┼───┘
│ printSessionId  │       │ printSessionId  │
│ eventType       │       │ filename        │
│ sentAt          │       │ status          │
│                 │       │ startedAt       │
│ (U: printerId,  │       │ endedAt         │
│     session,    │       │ printDurationSec│
│     eventType)  │       │ totalDurationSec│
└─────────────────┘       │ filamentUsedMm  │
                          │ errorMessage    │
                          └─────────────────┘
```

## API Endpoints

### Authentication
- `POST /api/auth/telegram` - Login via Telegram initData
- `GET /api/me` - Check current auth status

### Printers
- `GET /api/printers` - List all printers
- `POST /api/printers` - Create printer
- `PATCH /api/printers/:id` - Update printer
- `DELETE /api/printers/:id` - Delete printer
- `POST /api/printers/:id/pause` - Pause print
- `POST /api/printers/:id/resume` - Resume print
- `POST /api/printers/:id/cancel` - Cancel print
- `POST /api/printers/:id/emergency_stop` - Emergency stop
- `POST /api/printers/:id/firmware_restart` - Restart firmware

### Printer Models
- `GET /api/printer-models` - List all models
- `POST /api/printer-models` - Create model

### Presets
- `GET /api/presets` - List all presets
- `POST /api/presets` - Create preset
- `POST /api/presets/:id/print` - Start print on selected printers

### History
- `GET /api/history` - Get print history

### Settings
- `GET /api/settings/notifications` - Get notification settings
- `PATCH /api/settings/notifications` - Update notification settings

### Security
- `GET /api/security` - Get security info
- `GET /api/security/allowed-users` - List allowed users
- `POST /api/security/allow` - Allow user by telegramId
- `POST /api/security/disallow` - Remove user access

### Status
- `GET /api/status` - Backend version and uptime

## WebSocket Protocol

### Client → Server Messages
```typescript
// Request printer models
{ type: 'REQ_PRINTER_MODELS', payload: { requestId: string } }

// Request presets
{ type: 'REQ_PRESETS', payload: { requestId: string } }

// Request history
{ type: 'REQ_HISTORY', payload: { requestId: string, status?: string, limit: number, offset: number } }
```

### Server → Client Messages
```typescript
// Printer snapshots
{ type: 'PRINTERS_SNAPSHOT', payload: { printers: PrinterDto[] } }
{ type: 'PRINTER_STATUS', payload: { printer: PrinterDto } }

// Preset snapshots
{ type: 'PRESETS_SNAPSHOT', payload: { presets: PresetDto[] } }
{ type: 'PRESET_UPDATED', payload: { presetId: string } }

// History snapshots
{ type: 'HISTORY_SNAPSHOT', payload: { query: {...}, history: PrintHistoryDto[], total: number } }
{ type: 'HISTORY_EVENT', payload: { history: PrintHistoryDto } }

// Printer models
{ type: 'PRINTER_MODELS_SNAPSHOT', payload: { models: { id: string, name: string }[] } }
```

## Compatibility Logic

When selecting printers for a preset, the following checks are performed:

```typescript
function computePresetCompatibilityReasons(input: {
  presetRules: PresetCompatibilityRulesDto;
  printer: PrinterDto;
}): CompatibilityReason[] {
  const reasons: CompatibilityReason[] = [];

  // 1. Model check
  if (allowedModelIds.size > 0 && !allowedModelIds.has(printer.modelId)) {
    reasons.push('MODEL_NOT_ALLOWED');
  }

  // 2. Bed size check
  if (printer.bedX < presetRules.minBedX || printer.bedY < presetRules.minBedY) {
    reasons.push('BED_TOO_SMALL');
  }

  // 3. Nozzle check
  if (allowedNozzles.length > 0 && !allowedNozzles.includes(printer.nozzleDiameter)) {
    reasons.push('NOZZLE_NOT_ALLOWED');
  }

  // 4. Printer state check
  const state = printer.snapshot?.state;
  if (state === 'offline') {
    reasons.push('OFFLINE');
  } else if (state === 'printing' || state === 'paused') {
    reasons.push('PRINTER_BUSY');
  } else if (state !== 'standby') {
    reasons.push('PRINTER_NOT_READY');
  }

  return reasons;
}
```

## Notification Events

| Event              | Trigger Condition                    |
|--------------------|--------------------------------------|
| FIRST_LAYER_DONE   | Layer 1 completed (progress ~1-3%)   |
| PRINT_COMPLETE     | Print finished successfully          |
| PRINT_ERROR        | Printer entered error state          |

Each notification is sent **once per print session** to avoid spam.

## Security Model

1. **Authentication**: Only Telegram WebApp initData is accepted
2. **Authorization**: Users must be in `allowedTelegramUserIds` env var OR have `isAllowed=true` in DB
3. **API Key Storage**: Moonraker API keys are encrypted with AES-256-GCM before storage
4. **Token Management**: Backend issues JWT tokens, stored in localStorage

## Environment Variables

### Backend
- `TELEGRAM_BOT_TOKEN` - Telegram bot token
- `PRINTER_API_KEY_ENC_KEY` - Encryption key for Moonraker API keys
- `DATABASE_URL` - SQLite database path
- `FILES_DIR` - Directory for gcode files
- `ALLOWED_TELEGRAM_USER_IDS` - Comma-separated user IDs (optional)
- `TELEGRAM_WEBAPP_URL` - URL of the Telegram Mini App

### Frontend
- `NEXT_PUBLIC_BACKEND_BASE_URL` - Backend HTTP URL
- `NEXT_PUBLIC_BACKEND_WS_URL` - Backend WebSocket URL

## File Structure

```
farma/
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   └── schema.prisma        # Database schema
│   │   └── src/
│   │       ├── printer_runtime.ts   # Printer management
│   │       ├── moonraker_http.ts    # Moonraker API client
│   │       ├── telegram_bot.ts      # Telegram bot
│   │       ├── notification_service.ts  # Notifications
│   │       ├── crypto_api_key.ts    # API key encryption
│   │       ├── telegram_init_data.ts    # Telegram auth
│   │       ├── snapshot_cache.ts    # Printer state cache
│   │       ├── preset_meta_service.ts   # Preset metadata
│   │       └── read_only.ts         # Read-only guard stub
│   │
│   └── frontend/
│       └── app/
│           ├── auth/
│           │   └── auth_context.tsx # Auth provider
│           ├── ws/
│           │   └── ws_context.tsx    # WebSocket provider
│           ├── components/
│           │   ├── ClientRoot.tsx    # Root with providers
│           │   ├── AppShell.tsx      # Navigation shell
│           │   ├── BootstrapGate.tsx # Auth guard
│           │   └── ui/               # UI components
│           ├── lib/
│           │   ├── api.ts            # HTTP client
│           │   ├── ws.ts             # WebSocket client
│           │   ├── telegram.ts       # Telegram helpers
│           │   ├── env.ts            # Environment
│           │   ├── dto.ts            # Types
│           │   ├── schemas.ts        # Validation
│           │   ├── compatibility.ts  # Preset compatibility
│           │   └── printer_label.ts  # Label generator
│           ├── dashboard/            # Dashboard page
│           ├── presets/              # Presets pages
│           ├── printers/             # Printers pages
│           ├── history/              # History page
│           └── settings/             # Settings page
│
├── packages/
│   └── shared/
│       └── src/
│           ├── dto.ts                # Shared DTOs
│           ├── enums.ts              # Enums
│           ├── ws.ts                 # WebSocket types
│           ├── zod.ts                # Validation schemas
│           └── compatibility.ts      # Compatibility logic
│
└── docs/
    └── external_api/                 # Moonraker API docs
```
