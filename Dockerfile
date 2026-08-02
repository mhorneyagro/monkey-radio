# Production image for Monkey Radio (broadcast + dashboard + stream)
FROM node:20-bookworm AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/broadcast-worker/package.json ./packages/broadcast-worker/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/library-worker/package.json ./packages/library-worker/
COPY packages/stream-worker/package.json ./packages/stream-worker/

RUN npm ci --ignore-scripts

COPY tsconfig.base.json ./
COPY packages ./packages

RUN npm run build

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
COPY --from=builder /app/packages ./packages
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

EXPOSE 5400

COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["all"]
