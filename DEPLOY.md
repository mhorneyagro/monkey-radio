# Monkey Radio — Production Launch Guide

This guide walks through launching Monkey Radio as a 24/7 YouTube live stream with audience chat and a monitoring dashboard.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ broadcast-worker│────▶│ SQLite + MP3s    │◀────│ dashboard :5400 │
│ (play loop, DJ) │     │ (shared state)   │     │ (monitor + APIs)│
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                        ┌──────────────────┐              │ /canvas/stream
                        │ stream-worker    │◀─────────────┘
                        │ Chromium + ffmpeg│
                        └────────┬─────────┘
                                 │ RTMP
                                 ▼
                        ┌──────────────────┐
                        │ YouTube Live     │
                        │ (chat → DJ brain)│
                        └──────────────────┘
```

## Prerequisites

- **Node.js 20+** (local dev) or **Docker** (production)
- **ffmpeg** (local stream worker)
- **Google Cloud project** with YouTube Data API v3 enabled
- **OpenAI API key** — DJ mood + scripts
- **ElevenLabs API key + voice ID** — DJ TTS + music generation
- **YouTube API key** — live chat polling
- A Linux VM or server for 24/7 Docker deployment (recommended: 4 vCPU, 8 GB RAM, 50 GB disk)

## Step 1 — Prepare the library

Generate enough tracks so broadcast can run continuously:

```bash
npm install
cp .env.example .env
# Set OPENAI_API_KEY and ELEVENLABS_API_KEY in .env

npm run library:generate -- --count 10
npm run analyze:audio -- data/staging/songs
npm run library:process-staging
npm run library:health -- --relaxed
```

Target: at least 10 ready tracks total (50+ recommended for variety). Replace temporary Internet Archive tracks with ElevenLabs-generated music before going live.

## Step 2 — Configure production credentials

Edit `.env`:

```bash
# DJ brain (required for production)
OPENAI_API_KEY=sk-...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...

# YouTube live chat
CHAT_PROVIDER=youtube
YOUTUBE_API_KEY=...

# Admin dashboard controls
ADMIN_API_KEY=choose-a-strong-random-key
```

## Step 3 — YouTube OAuth + live broadcast

1. In [Google Cloud Console](https://console.cloud.google.com/):
   - Enable **YouTube Data API v3**
   - Create OAuth 2.0 credentials (Web application)
   - Add redirect URI: `http://localhost:8765/oauth/callback`

2. Authorize with live streaming scopes:

```bash
# Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first
npm run youtube:live-auth
# Copy YOUTUBE_REFRESH_TOKEN into .env
```

3. Create the live broadcast and get RTMP credentials:

```bash
npm run youtube:live-create
# Copy the printed values into .env:
#   YOUTUBE_BROADCAST_ID, YOUTUBE_RTMP_URL, YOUTUBE_STREAM_KEY, YOUTUBE_VIDEO_ID
```

## Step 4 — Launch locally (smoke test)

Terminal 1 — broadcast:
```bash
npm run broadcast:start
```

Terminal 2 — dashboard:
```bash
npm run dashboard:start
```

Open http://localhost:5400 — verify playback, DJ segments, and chat.

Terminal 3 — stream (Linux with Xvfb + PulseAudio, or use Docker):
```bash
npm run stream:start
```

Once ffmpeg is pushing RTMP, go live on YouTube:
```bash
npm run youtube:live-go
```

Check status:
```bash
npm run youtube:live-status
```

## Step 5 — Production Docker deployment

On your 24/7 server:

```bash
git clone <your-repo> monkey-radio
cd monkey-radio
cp .env.example .env
# Fill in all production credentials (Step 2 + Step 3)

# Ensure data/ has your library
npm run production:build
npm run production:up
```

Monitor:
```bash
npm run production:logs
curl http://localhost:5400/api/status
```

The dashboard is available at `http://<server-ip>:5400`. Use the admin key field in the UI for skip-to-transition controls.

### Docker services

The production container runs three processes:
- **broadcast-worker** — 24/7 play loop + DJ brain + chat polling
- **dashboard** — monitoring UI + APIs + stream canvas
- **stream-worker** — headless Chromium + ffmpeg → YouTube RTMP

Data persists in `./data/` (SQLite + MP3 library + DJ segments).

## Step 6 — Alternative: OBS (manual MVP)

If you prefer not to run the stream-worker yet:

1. Run broadcast + dashboard locally or in Docker (without stream worker)
2. Open `/canvas/stream` in OBS as a **Browser Source** (1920×1080)
3. Set OBS stream to YouTube RTMP (use credentials from `youtube:live-create`)
4. Start streaming, then run `npm run youtube:live-go`

This is the fastest path to go live but requires manual OBS supervision.

## Monitoring checklist

| Check | Command / URL |
|-------|---------------|
| Dashboard health | `curl http://localhost:5400/health` |
| Full system status | `curl http://localhost:5400/api/status` |
| Library health | `npm run library:health -- --relaxed` |
| YouTube broadcast | `npm run youtube:live-status` |
| Live chat working | Messages appear in dashboard + DJ shoutouts |

## Troubleshooting

**Broadcast shows "Offline" in status panel**
→ Ensure `npm run broadcast:start` is running and library has ≥10 tracks.

**Stream worker can't autoplay audio**
→ Use `/canvas/stream` (not `/canvas`). The stream page auto-starts without user gesture.

**YouTube chat not appearing**
→ Set `CHAT_PROVIDER=youtube`, `YOUTUBE_VIDEO_ID` (broadcast ID), and `YOUTUBE_API_KEY`. Stream must be live.

**ffmpeg RTMP connection refused**
→ Verify `YOUTUBE_RTMP_URL` and `YOUTUBE_STREAM_KEY`. Run `youtube:live-create` again if keys expired.

**Skip button returns 401**
→ Enter your `ADMIN_API_KEY` in the dashboard admin key field and click Save.

## Security notes

- Set `ADMIN_API_KEY` in production — protects skip-to-transition
- Do not expose port 5400 publicly without a reverse proxy + auth if the server is on the internet
- Back up `./data/monkey-radio.db` and `./data/library/` regularly

## Legal

- Verify ElevenLabs terms allow commercial live streaming of generated music
- Ensure all tracks in the library are properly licensed for broadcast

---

## Deploying on Render (paid)

Render works well for Monkey Radio because you can run the full Docker stack as a single **Web Service** with a **persistent disk**. Vercel cannot run this workload (no long-lived processes, no ffmpeg/Chromium).

### Architecture on Render

```
┌─────────────────────────────────────────────────────────────┐
│ Render Web Service (Docker, Pro 4 GB)                       │
│  broadcast-worker + dashboard + stream-worker               │
│  Persistent disk → /app/data (SQLite, DJ segments)          │
└───────────────────────────┬─────────────────────────────────┘
                            │ now-playing audioUrl
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Cloudflare R2 + CDN  (recommended)                          │
│  All track MP3s — durable, cheap, global edge cache         │
└─────────────────────────────────────────────────────────────┘
                            │ RTMP
                            ▼
                     YouTube Live
```

**Why split storage?**

| Data | Where | Why |
|------|-------|-----|
| Track MP3s (~GBs) | **R2 / S3 + CDN** | Cheap, durable, offloads bandwidth from Render |
| SQLite + DJ segments | **Render persistent disk** | Small, frequently written, co-located with broadcast |
| Stream encoding | **Same Render container** | Chromium must play audio locally for RTMP capture |

### Render setup

1. Push this repo to GitHub
2. Fill in `.env` (aligned with `.env.example`)
3. Run `npm run render:env` — generates `.env.render` with production secrets
4. Run `render login` then `npm run render:deploy`
5. In Render Dashboard: **New → Blueprint** → connect repo → apply `render.yaml`
6. When prompted for `sync: false` secrets, paste values from `.env.render`
7. Set `LIBRARY_CDN_URL` to your R2 public domain (e.g. `https://library.yourdomain.com`)

Re-deploy after code changes: `npm run render:deploy:trigger`

Public monitoring UI: `https://monkey-radio.onrender.com` (your service URL).

Internal stream capture uses `DASHBOARD_URL=http://localhost:5400` (already set in `render.yaml`) so Chromium talks to the co-located dashboard, not the public URL.

### Render checklist

- [ ] Pro plan (4 GB RAM minimum)
- [ ] Persistent disk mounted at `/app/data`
- [ ] All secrets set in Render dashboard
- [ ] Library synced to CDN (see below)
- [ ] `LIBRARY_CDN_URL` set in Render env
- [ ] YouTube RTMP credentials configured
- [ ] Run `youtube:live-go` after first deploy once RTMP is flowing

### Render limitations to know

- **Single instance only** — persistent disk cannot be shared across instances
- **No `shm_size: 2gb`** like Docker Compose — if Chromium crashes, upgrade to Pro Plus (8 GB) or contact Render support
- **Ephemeral deploys** — code redeploys don't wipe the disk, but always back up `/app/data/monkey-radio.db`

---

## CDN for music (Cloudflare R2)

Recommended: **Cloudflare R2** with a custom domain (e.g. `library.yourdomain.com`). R2 has no egress fees and works with Cloudflare's CDN.

### 1. Create R2 bucket

1. Cloudflare dashboard → R2 → Create bucket (`monkey-radio-library`)
2. Settings → CORS → paste rules from `infra/r2-cors.json` (required for browser/canvas playback)
3. Connect a custom domain under R2 bucket settings

### 2. Upload library

On your dev machine after generating tracks:

```bash
export R2_BUCKET=monkey-radio-library
export R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
export AWS_ACCESS_KEY_ID=...   # R2 API token
export AWS_SECRET_ACCESS_KEY=...

chmod +x scripts/sync-library-to-r2.sh
./scripts/sync-library-to-r2.sh ./data/library
```

Track `file_path` values in SQLite already use relative keys like `ambient/track.mp3` — these map directly to R2 object keys.

### 3. Configure CDN URL

```bash
LIBRARY_CDN_URL=https://library.yourdomain.com
```

When set, `/api/broadcast/now-playing` returns CDN URLs for tracks. DJ segments still use `/api/audio/dj/:id` on the Render server (they're generated live during broadcast).

### CDN alternatives

| Provider | Good for | Notes |
|----------|----------|-------|
| **Cloudflare R2** | Best default | Cheap storage, free egress via Cloudflare CDN |
| **AWS S3 + CloudFront** | AWS ecosystem | More setup, egress costs |
| **Backblaze B2 + Cloudflare** | Lowest storage cost | S3-compatible API |
| **Render disk only** | Quick start / dev | No CDN; library must fit on disk; bandwidth hits Render |

For launch, **R2 + Render** is the sweet spot: ~$7/mo Render Pro + ~$0.015/GB/mo R2 storage.

### Workflow when adding new tracks

1. Generate locally: `npm run library:generate` → analyze → import
2. Sync to R2: `./scripts/sync-library-to-r2.sh`
3. Copy `monkey-radio.db` to Render disk (or re-import on server)
4. Broadcast picks up new tracks automatically

