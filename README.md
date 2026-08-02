# Monkey Radio

A fully automated 24/7 YouTube live radio station.

- **Worker 1 (library-worker)** — generates tracks via ElevenLabs Music API (or seeds temporary tracks from Internet Archive)
- **Worker 2 (broadcast-worker)** — plays tracks, polls chat, LLM picks mood/genre, writes DJ scripts, ElevenLabs TTS, logs everything
- **Dashboard** — live now-playing UI with audio playback

## Prerequisites

- Node.js 20+
- npm
- **OpenAI API key** — random genre selection for generation
- **ElevenLabs API key** — music generation (`/v1/music`)

Optional:
- Docker + Suno Pro — legacy browser/gcui generation path only

## Legal

- Check ElevenLabs terms for commercial use of generated music before streaming
- YouTube imports must be tracks you own the rights to

## Setup

```bash
npm install
cp .env.example .env
```

Set `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` in `.env`.

### Generate → analyze → import pipeline

Generation writes MP3s to a staging directory. Genre tagging happens later via Essentia analysis at import time.

```bash
# 1. LLM picks a random genre, ElevenLabs generates instrumental tracks
npm run library:generate -- --count 5

# 2. Batch analyze BPM, key, mood, and map to Monkey Radio genres
npm run analyze:audio -- data/staging/songs

# 3. Name tracks, then import into the library database
npm run library:process-staging

# Or step by step:
# npm run library:name-tracks -- --analysis data/staging/songs/analysis.json
# npm run library:import-analysis -- --analysis data/staging/songs/analysis.json
```

Staging output lives in `data/staging/songs/` (override with `STAGING_PATH`). Each run appends to `manifest.json` with the LLM-chosen genre label and prompt used.

### Legacy: Suno browser generation

```bash
npm run library:suno-install
npm run library:suno-login
```

Set `SUNO_PROVIDER=browser` in `.env`. When Suno asks for a CAPTCHA, solve it manually in the browser window.

### Legacy: gcui-art/suno-api (Docker)

If you prefer the third-party proxy, set `SUNO_PROVIDER=gcui` and run:

```bash
npm run suno-api:setup
npm run suno-api:up
```

## CLI

```bash
# Generate tracks to staging (recommended)
npm run library:generate -- --count 5

# Seed temporary royalty-free tracks from Internet Archive (no API key)
npm run library:seed -- --tracks-per-genre 10

# Seed one genre
npm run library:seed -- --tracks-per-genre 10 --genre ambient

# Fill library via Suno (when ready)
npm run library:fill -- --tracks-per-genre 20

# Fill one genre (only enqueues what's needed to reach target)
npm run library:fill -- --tracks-per-genre 2 --genre funk

# Log into Suno (optional — library:fill opens browser and logs in if needed)
npm run library:suno-login

# Continuously fill deficits until all genres meet target
npm run library:watch -- --tracks-per-genre 20

# Show track counts per genre
npm run library:status

# Retry failed generation jobs
npm run library:retry

# Check minimum library health (10 tracks per genre by default)
npm run library:health

# Relaxed health — ignores empty genres (matches broadcast startup gate)
npm run library:health -- --min 1 --relaxed
```

## Broadcast

The broadcast worker runs the full loop:

```
PLAY TRACK → DJ SEGMENT → PLAY TRACK → …
```

During each track it polls chat, and ~30s before the track ends it pre-generates the DJ segment (LLM mood → LLM script → ElevenLabs TTS). DJ Monkey comments on the last song, teases the next one, and gives chat shoutouts.

```bash
npm run broadcast:start
```

### DJ / LLM / ElevenLabs

Add to `.env` for real voice (without keys, mock LLM + mock TTS are used automatically):

```
OPENAI_API_KEY=sk-...
LLM_MODEL=gpt-4o-mini
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
```

Optional YouTube live chat (otherwise `CHAT_PROVIDER=mock` injects sample messages):

```
CHAT_PROVIDER=youtube
YOUTUBE_VIDEO_ID=...
YOUTUBE_API_KEY=...
```

Tune DJ frequency:

```
MIN_TRACKS_BEFORE_DJ=1      # songs between DJ breaks
DJ_MIN_INTERVAL_SEC=120     # minimum seconds between DJ segments
DJ_PREP_LEAD_SEC=30         # start generating DJ this many seconds before track ends
```

## Dashboard

Web UI for live playback monitoring:

```bash
# Terminal 1 — broadcast worker
npm run broadcast:start

# Terminal 2 — dashboard
npm run dashboard:dev
```

Open http://localhost:5400

Shows:
- Now playing (title, genre, progress bar)
- **DJ Monkey** segments between songs (script + audio)
- HTML5 audio player with volume/mute
- Recently played tracks and DJ segment history

## Temporary dev library (Internet Archive)

While Suno generation is on hold, seed the library with royalty-free tracks from [Internet Archive netlabels](https://archive.org/details/netlabels):

```bash
npm run library:seed -- --tracks-per-genre 10
npm run library:health
```

No API key required. Tracks are tagged `temporary: true` in metadata — replace with Suno-generated tracks before going live on YouTube.

## Local testing (no Suno)

Set `SUNO_PROVIDER=mock` in `.env`. The mock provider simulates generation and writes placeholder MP3 files.

## Suno provider

Suno has no official public API. This project uses a swappable `SunoProvider` interface:

| Provider | `SUNO_PROVIDER` | Use case |
|----------|-----------------|----------|
| **GcuiSunoProvider** (default) | `gcui` | Self-hosted [gcui-art/suno-api](https://github.com/gcui-art/suno-api) using your Suno Pro account |
| `HttpSunoProvider` | `http` | Third-party gateway (Kunavo, Sunor, etc.) |
| `MockSunoProvider` | `mock` | Local dev / CI |

### gcui-art/suno-api (recommended)

Tracks are generated under **your own Suno Pro account** — the best option for commercial streaming rights.

**Architecture:**

```
library-worker  →  gcui-art/suno-api (localhost:3001)  →  suno.com
```

**Commands:**

```bash
npm run suno-api:setup   # Clone gcui-art/suno-api into infra/suno-api/upstream
npm run suno-api:up      # Start via Docker
npm run suno-api:down    # Stop
npm run suno-api:logs    # Tail logs
```

**API endpoints used:**

- `POST /api/generate` — submit prompt, returns 2 clip IDs
- `GET /api/get?ids=...` — poll until `status: "streaming"` and `audio_url` is available

Configure in `.env`:

```
SUNO_PROVIDER=gcui
SUNO_API_BASE_URL=http://localhost:3001
```

gcui-art/suno-api credentials go in `infra/suno-api/.env`:

```
SUNO_COOKIE=...
TWOCAPTCHA_KEY=...
```

### Third-party gateway (alternative)

Set `SUNO_PROVIDER=http` and configure `SUNO_API_BASE_URL` + `SUNO_API_KEY` for Kunavo, Sunor, or similar.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SUNO_PROVIDER` | `gcui` | `gcui`, `http`, or `mock` |
| `SUNO_API_BASE_URL` | `http://localhost:3001` | gcui-art/suno-api base URL |
| `SUNO_API_KEY` | — | Required only for `http` provider |
| `LIBRARY_PATH` | `./data/library` | MP3 storage directory |
| `DATABASE_PATH` | `./data/monkey-radio.db` | SQLite database path |
| `TRACKS_PER_GENRE` | `20` | Default tracks per genre for fill |
| `MAX_CONCURRENT_GENERATIONS` | `2` | Parallel generation limit |
| `GENERATION_POLL_INTERVAL_MS` | `10000` | Poll interval for Suno jobs |
| `GENERATION_TIMEOUT_MS` | `300000` | Max wait per generation (5 min) |
| `PREFER_INSTRUMENTAL` | `true` | Request instrumental tracks |
| `MAX_RETRIES` | `3` | Retry failed jobs up to N times |
| `DASHBOARD_PORT` | `5400` | Dashboard HTTP port |
| `DEFAULT_GENRE` | `lofi` | Starting genre for broadcast worker |
| `AVOID_REPLAY_LIMIT` | `50` | Skip recently played tracks |
| `MIN_LIBRARY_PER_GENRE` | `10` | Minimum tracks per genre before broadcast starts |
| `DJ_PATH` | `./data/dj` | Generated DJ segment MP3s |
| `OPENAI_API_KEY` | — | LLM for mood + DJ scripts (mock if unset) |
| `LLM_MODEL` | `gpt-4o-mini` | OpenAI model for DJ brain |
| `ELEVENLABS_API_KEY` | — | TTS for DJ voice (mock if unset) |
| `ELEVENLABS_VOICE_ID` | — | ElevenLabs voice ID |
| `CHAT_PROVIDER` | `mock` | `mock`, `youtube`, or `none` |
| `MIN_TRACKS_BEFORE_DJ` | `1` | Songs between DJ segments |
| `DJ_MIN_INTERVAL_SEC` | `120` | Minimum gap between DJ segments |

## Project structure

```
packages/
  shared/           Shared types, DB schema, genres, config
  library-worker/   Worker 1: Suno generation pipeline + CLI
  broadcast-worker/ Worker 2: track selection + playback loop
  dashboard/        Web UI for monitoring workers and playback
infra/
  suno-api/         Docker setup for gcui-art/suno-api
data/               Gitignored — library MP3s + SQLite DB
```

## Library health gate

`checkLibraryHealth()` (exported from `@monkey-radio/shared`) verifies each genre has at least 10 ready tracks. The broadcast worker uses this as a startup gate.

## Production launch (24/7 YouTube Live)

See **[DEPLOY.md](./DEPLOY.md)** for the full production guide:

1. Fill the library with ElevenLabs-generated tracks
2. Configure OpenAI + ElevenLabs + YouTube credentials
3. Create a YouTube live broadcast (`npm run youtube:live-create`)
4. Launch with Docker (`npm run production:up`) or locally
5. Go live when RTMP is flowing (`npm run youtube:live-go`)

The **dashboard** at http://localhost:5400 is your monitoring UI. The **stream-worker** captures `/canvas/stream` and pushes to YouTube RTMP.

## Build

```bash
npm run build
```

Shared is built automatically via `postinstall` after `npm install`.
