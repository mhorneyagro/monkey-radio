# Production image for Monkey Radio (broadcast + dashboard + stream)
FROM node:20-bookworm AS builder

WORKDIR /app

# Render injects NODE_ENV=production — override so devDependencies (typescript) install
ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false
ENV NPM_CONFIG_OMIT_DEV=false
ENV CI=true
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# better-sqlite3 native compile
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages

# Install deps (skip Playwright browser download; Chromium installed in runtime stage)
RUN npm ci --include=dev \
 && mkdir -p node_modules/@monkey-radio \
 && ln -sfn ../../packages/shared node_modules/@monkey-radio/shared \
 && test -f node_modules/.bin/tsc \
 && test -f node_modules/better-sqlite3/build/Release/better_sqlite3.node \
 && test -f node_modules/@monkey-radio/shared/package.json

RUN npm run build -w @monkey-radio/shared \
 && test -f packages/shared/dist/index.d.ts

RUN npm run build -w broadcast-worker \
 && npm run build -w @monkey-radio/dashboard \
 && npm run build -w stream-worker

# Runtime image with ffmpeg, Xvfb, PulseAudio, Playwright Chromium
FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    x11-utils \
    pulseaudio \
    pulseaudio-utils \
    gosu \
    curl \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    fonts-liberation \
    ca-certificates \
    awscli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/shared ./packages/shared
COPY --from=builder /app/packages/broadcast-worker ./packages/broadcast-worker
COPY --from=builder /app/packages/dashboard ./packages/dashboard
COPY --from=builder /app/packages/stream-worker ./packages/stream-worker
COPY package.json package-lock.json tsconfig.base.json tsconfig.build.json ./
COPY assets ./assets
COPY logo-*.png ./
COPY scripts ./scripts

RUN useradd -m -s /bin/bash -u 1001 streamer

ENV PLAYWRIGHT_BROWSERS_PATH=/app/.playwright
RUN npx playwright install chromium \
 && npx playwright install-deps chromium \
 && chmod -R a+rX /app/.playwright

ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PULSE_RUNTIME=/tmp/pulse-runtime
ENV PULSE_USER=streamer

VOLUME ["/app/data"]

EXPOSE 10000

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["all"]
