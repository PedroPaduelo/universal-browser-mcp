#!/bin/bash
set -e

echo "Starting Xvfb on :99..."
Xvfb :99 -screen 0 1280x900x24 -ac &
export DISPLAY=:99
sleep 1

echo "Starting Google Chrome with extension..."
/usr/bin/google-chrome \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --no-first-run \
  --disable-default-apps \
  --disable-extensions-except=/app/browser-extension \
  --load-extension=/app/browser-extension \
  --user-data-dir=/home/mcp/.config/google-chrome \
  "about:blank" &
sleep 3

echo "Starting MCP server on port 8080..."
exec node /app/mcp-server/dist/server.js
