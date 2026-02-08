# ============================================
# Stage 1: Build mcp-server and browser-extension
# ============================================
FROM node:22-slim AS builder

WORKDIR /build

# Build mcp-server
COPY mcp-server/package.json mcp-server/package-lock.json mcp-server/
COPY mcp-server/tsconfig.json mcp-server/
COPY mcp-server/src/ mcp-server/src/
RUN cd mcp-server && npm ci && npm run build

# Build browser-extension
COPY browser-extension/package.json browser-extension/package-lock.json browser-extension/
COPY browser-extension/esbuild.config.js browser-extension/
COPY browser-extension/src/ browser-extension/src/
RUN cd browser-extension && npm ci && npm run build

# ============================================
# Stage 2: Runtime
# ============================================
FROM node:22-slim AS runtime

# Install Google Chrome and Xvfb dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    wget \
    gnupg \
    ca-certificates \
    xvfb \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libxss1 \
    libxtst6 \
    libgbm1 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libasound2 \
    libgtk-3-0 \
    fonts-liberation \
    xdg-utils \
  && wget -q https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb \
  && apt-get install -y --no-install-recommends ./google-chrome-stable_current_amd64.deb \
  && rm google-chrome-stable_current_amd64.deb \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy mcp-server build artifacts and install production deps
COPY --from=builder /build/mcp-server/dist/ mcp-server/dist/
COPY --from=builder /build/mcp-server/package.json mcp-server/package.json
COPY --from=builder /build/mcp-server/package-lock.json mcp-server/package-lock.json
RUN cd mcp-server && npm ci --omit=dev

# Copy browser-extension (built assets + manifest + popup)
COPY --from=builder /build/browser-extension/dist/ browser-extension/dist/
COPY browser-extension/manifest.json browser-extension/manifest.json
COPY browser-extension/popup.html browser-extension/popup.html
COPY browser-extension/popup.js browser-extension/popup.js

# Copy entrypoint
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Create non-root user
RUN useradd -m -s /bin/bash mcp \
  && mkdir -p /home/mcp/.config/google-chrome \
  && chown -R mcp:mcp /app /home/mcp

USER mcp

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
