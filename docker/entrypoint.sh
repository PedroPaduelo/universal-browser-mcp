#!/bin/bash
set -e

echo "Starting Xvfb on :99..."
Xvfb :99 -screen 0 1280x900x24 -ac &
export DISPLAY=:99
sleep 1

echo "Starting x11vnc on port 5900..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport 5900 -forever -shared -q &
sleep 1

echo "Starting noVNC on port 6080..."
websockify --web /usr/share/novnc 6080 localhost:5900 &
sleep 1

echo "Starting MCP server on port 8080 (background)..."
node /app/mcp-server/dist/server.js &
MCP_PID=$!
sleep 3

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

echo "All services started. Waiting for MCP server (PID $MCP_PID)..."
wait $MCP_PID
