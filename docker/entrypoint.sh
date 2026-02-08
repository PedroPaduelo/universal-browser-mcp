#!/bin/bash

echo "=== Starting Universal Browser MCP ==="

echo "[1/5] Starting Xvfb on :99..."
Xvfb :99 -screen 0 1280x900x24 -ac &
export DISPLAY=:99
sleep 1
echo "  Xvfb started (PID $!)"

echo "[2/5] Starting x11vnc on port 5900..."
x11vnc -display :99 -nopw -listen 0.0.0.0 -rfbport 5900 -forever -shared -q &
sleep 1
echo "  x11vnc started (PID $!)"

echo "[3/5] Starting noVNC on port 6080..."
websockify --web /usr/share/novnc 6080 localhost:5900 &
sleep 1
echo "  noVNC started (PID $!)"

echo "[4/5] Starting MCP server on port 8080..."
node /app/mcp-server/dist/server.js &
MCP_PID=$!
echo "  MCP server started (PID $MCP_PID)"
echo "  Waiting 3s for WebSocket bridge (port 3002)..."
sleep 3

echo "[5/5] Starting Google Chrome with extension..."
echo "  Extension path: /app/browser-extension"
ls -la /app/browser-extension/ || echo "  WARNING: extension directory not found!"
echo "  User data dir: /home/mcp/.config/google-chrome"

# Clean up stale Chrome lock files from previous container runs
CHROME_DIR="/home/mcp/.config/google-chrome"
rm -f "$CHROME_DIR/SingletonLock" "$CHROME_DIR/SingletonSocket" "$CHROME_DIR/SingletonCookie"
echo "  Cleaned up Chrome lock files"

/usr/bin/google-chrome \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-gpu \
  --no-first-run \
  --disable-default-apps \
  --disable-extensions-except=/app/browser-extension \
  --load-extension=/app/browser-extension \
  --user-data-dir=/home/mcp/.config/google-chrome \
  "about:blank" 2>&1 &
CHROME_PID=$!
echo "  Chrome started (PID $CHROME_PID)"

sleep 2
if kill -0 $CHROME_PID 2>/dev/null; then
  echo "  Chrome is running OK"
else
  echo "  WARNING: Chrome may have crashed! Retrying..."
  /usr/bin/google-chrome \
    --no-sandbox \
    --disable-dev-shm-usage \
    --disable-gpu \
    --no-first-run \
    --disable-default-apps \
    --disable-extensions-except=/app/browser-extension \
    --load-extension=/app/browser-extension \
    --user-data-dir=/home/mcp/.config/google-chrome \
    "about:blank" 2>&1 &
  CHROME_PID=$!
  echo "  Chrome retry started (PID $CHROME_PID)"
fi

echo ""
echo "=== All services running ==="
echo "  MCP Server:  http://0.0.0.0:8080"
echo "  noVNC:       http://0.0.0.0:6080/vnc.html"
echo "  WS Bridge:   ws://localhost:3002 (internal)"
echo ""

wait $MCP_PID
