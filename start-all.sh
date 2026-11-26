#!/bin/sh
set -e

BOT_PID=""
KENER_PID=""

shutdown() {
  [ -n "$BOT_PID" ] && kill -TERM "$BOT_PID" 2>/dev/null || true
  [ -n "$KENER_PID" ] && kill -TERM "$KENER_PID" 2>/dev/null || true
}
trap shutdown TERM INT

if [ -n "$DISCORD_TOKEN" ] && [ -n "$DISCORD_CLIENT_ID" ] && [ -n "$DISCORD_GUILD_ID" ]; then
  echo "[bot] Starting OnboardOps staff Discord bot..."
  (
    NODE_PID=""
    trap '[ -n "$NODE_PID" ] && kill -TERM "$NODE_PID" 2>/dev/null || true; exit 0' TERM INT
    cd /discord-bot
    while true; do
      BOT_HEALTH_PORT="${BOT_HEALTH_PORT:-3001}" NODE_OPTIONS="" node index.js &
      NODE_PID=$!
      wait "$NODE_PID" || true
      echo "[bot] Exited; restarting in 5s..."
      sleep 5
    done
  ) &
  BOT_PID=$!
else
  echo "[bot] DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID not set; running status page only."
fi

./docker-entrypoint.sh "$@" &
KENER_PID=$!
wait "$KENER_PID"
STATUS=$?
shutdown
exit "$STATUS"
