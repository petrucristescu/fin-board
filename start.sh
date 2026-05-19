#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

python server.py &
SERVER_PID=$!

echo "Server started (PID $SERVER_PID) on http://localhost:8000"

# Wait for server to be ready
for i in $(seq 1 10); do
  if curl -sf http://localhost:8000 > /dev/null 2>&1; then
    break
  fi
  sleep 0.5
done

# Open browser (cross-platform)
if command -v xdg-open &>/dev/null; then
  xdg-open http://localhost:8000
elif command -v open &>/dev/null; then
  open http://localhost:8000
elif command -v start &>/dev/null; then
  start http://localhost:8000
fi

wait $SERVER_PID
