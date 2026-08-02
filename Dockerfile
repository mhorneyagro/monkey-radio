# Production image for Monkey Radio (broadcast + dashboard + stream)
FROM node:20-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/broadcast-worker ./packages/broadcast-worker
COPY packages/dashboard ./packages/dashboard
COPY packages/stream-worker ./packages/stream-worker

RUN npm ci --workspace @monkey-radio/shared --workspace broadcast-worker --workspace @monkey-radio/dashboard --workspace stream-worker

RUN npm run build -w @monkey-radio/shared \
 && npm run build -w broadcast-worker \
 && npm run build -w @monkey-radio/dashboard \
 && npm run build -w stream-worker

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
COPY package.json ./
COPY tsconfig.base.json ./
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
