set -euo pipefail

ENV=/home/onem/apps/farma-klipper-telegram/apps/backend/.env

TS=$(date +%s)
cp "$ENV" "$ENV.bak.$TS"

TMP=$(mktemp)
grep -v -E '^(BASE_URL_PUBLIC|CORS_ORIGIN|TELEGRAM_WEBAPP_URL)=' "$ENV" > "$TMP"
{
  echo 'BASE_URL_PUBLIC=https://api.qlinka.ru'
  echo 'CORS_ORIGIN=https://farma-klipper-telegram-frontend.vercel.app'
  echo 'TELEGRAM_WEBAPP_URL=https://farma-klipper-telegram-frontend.vercel.app'
} >> "$TMP"

install -o onem -g onem -m 600 "$TMP" "$ENV"
rm -f "$TMP"

systemctl restart farma-backend.service
sleep 2

systemctl is-active farma-backend.service
curl -fsS http://127.0.0.1:3001/api/health
echo
curl -fsS https://api.qlinka.ru/api/health
echo

# CORS check
curl -I -fsS -H 'Origin: https://farma-klipper-telegram-frontend.vercel.app' https://api.qlinka.ru/api/health | sed -n '1,30p'
