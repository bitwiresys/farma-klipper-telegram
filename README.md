# Farma (Klipper/Moonraker Telegram Mini App)

## Manual E2E checklist (Presets)

1. **Create printer model**

- Open the app: `/printers`
- Use `Add model (inline)` to create a model.

2. **Add printer**

- Go to `/printers`
- Create a printer (displayName/model/baseUrl/apiKey).
- Ensure printer appears in the list.

3. **Create preset**

- Go to `/presets`
- Tap `New`
- Upload a `.gcode` file
- Fill: `title`, `plasticType`, `colorHex`, optional `description`
- Set compatibility rules:
  - allowed models
  - allowed nozzle diameters
  - min bed X/Y
- Tap `Create preset`

4. **See preset thumbnail**

- Open preset details `/presets/[id]`
- If backend has cached a thumbnail, it will show in the header.

5. **Select compatible printers (incompatible disabled)**

- In preset details page:
  - incompatible printers are disabled and show reasons
  - use `Select all compatible` to quickly select

6. **Start print (no auto actions)**

- Tap `START PRINT`
- Confirm in the modal
- Observe per-printer results / errors

Notes:

- Write operations (upload/start/pause/resume/cancel) must be tested only against a mock Moonraker server.
