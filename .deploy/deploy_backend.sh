set -euo pipefail

REPO=/home/onem/apps/farma-klipper-telegram

cd "$REPO"

git pull

sudo chown -R onem:onem "$REPO"

sudo -u onem bash -lc "cd '$REPO'; export CI=1; pnpm install --frozen-lockfile"

sudo -u onem bash -lc "cd '$REPO'; pnpm -C packages/shared build"

sudo -u onem bash -lc "cd '$REPO'; pnpm -C apps/backend build"

sudo -u onem bash -lc "cd '$REPO'; pnpm -C apps/backend prisma:deploy"

sudo chown -R onem:onem "$REPO/apps/backend/prisma"

sudo systemctl restart farma-backend.service
sleep 2

sudo systemctl status farma-backend.service --no-pager -l | head -n 35

echo ---
journalctl -u farma-backend.service -n 120 --no-pager -o cat | tail -n 60

echo ---
curl -fsS http://127.0.0.1:3001/api/health
