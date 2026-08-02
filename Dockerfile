# Production image for Monkey Radio (broadcast + dashboard + stream)
FROM node:20-bookworm AS builder

WORKDIR /app

# Render injects NODE_ENV=production — override so devDependencies (typescript) install
ENV NODE_ENV=development
ENV NPM_CONFIG_PRODUCTION=false
ENV CI=true

# better-sqlite3 native compile
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json tsconfig.base.json tsconfig.build.json ./
COPY packages ./packages

# Skip lifecycle scripts (library-worker playwright download); build explicitly below
RUN npm ci --include=dev --ignore-scripts \
 && mkdir -p node_modules/@monkey-radio \
 && ln -sfn ../../packages/shared node_modules/@monkey-radio/shared \
 && test -f node_modules/@monkey-radio/shared/package.json

RUN ./node_modules/.bin/tsc -b packages/shared \
 && ./node_modules/.bin/tsc -b packages/broadcast-worker \
 && ./node_modules/.bin/tsc -b packages/dashboard \
 && ./node_modules/.bin/tsc -b packages/stream-worker

# Runtime image with ffmpeg, Xvfb, PulseAudio, Playwright Chromium
FROM node:20-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    pulseaudio \
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

RUN npx playwright install chromium

ENV NODE_ENV=production
ENV DISPLAY=:99
ENV PULSE_SERVER=unix:/tmp/pulse/native

VOLUME ["/app/data"]

EXPOSE 10000

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["all"]
