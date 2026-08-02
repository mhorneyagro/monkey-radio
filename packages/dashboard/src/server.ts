import { config } from "dotenv";
import { randomUUID } from "node:crypto";
import express from "express";
import { createReadStream, existsSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkLibraryHealth,
  getBroadcastPlayback,
  getRecentDjSegments,
  getRecentPlaybackWithTracks,
  getRecentChatMessages,
  getTrackById,
  getReadyTrackCountByGenre,
  insertChatMessage,
  loadBroadcastWorkerConfig,
  loadDashboardConfig,
  loadLibraryWorkerConfig,
  moodHasPendingDj,
  openDatabase,
  SKIP_TO_TRANSITION_LEAD_MS,
  resolveBroadcastConfigPaths,
  resolveConfigPaths,
  resolveDjAbsolutePath,
  resolveTrackAbsolutePath,
  resolveTrackAudioUrl,
  skipTargetOffsetMs,
  trackDurationMs,
  trackStartIsoForOffset,
  updateBroadcastState,
} from "@monkey-radio/shared";
import { buildNowPlayingResponse } from "./now-playing.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
config({ path: resolve(repoRoot, ".env") });

const libraryConfig = resolveConfigPaths(loadLibraryWorkerConfig(), repoRoot);
const broadcastConfig = resolveBroadcastConfigPaths(
  loadBroadcastWorkerConfig(),
  repoRoot,
);
const dashboardConfig = loadDashboardConfig();
const db = openDatabase(libraryConfig.databasePath);
const publicDir = join(__dirname, "../public");
const port = dashboardConfig.port;

const app = express();
app.use(express.json());

function requireAdmin(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  if (!dashboardConfig.adminApiKey) {
    next();
    return;
  }

  const headerKey = req.headers["x-admin-key"];
  const authHeader = req.headers.authorization;
  const provided =
    (typeof headerKey === "string" ? headerKey : undefined) ??
    (typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : undefined);

  if (provided !== dashboardConfig.adminApiKey) {
    res.status(401).json({ error: "Unauthorized — set x-admin-key header" });
    return;
  }

  next();
}

function serveRepoRootLogo(filename: string) {
  return (_req: express.Request, res: express.Response) => {
    const logoPath = resolve(repoRoot, filename);
    if (!existsSync(logoPath)) {
      res.status(404).json({ error: `${filename} not found in repo root` });
      return;
    }

    const stat = statSync(logoPath);
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("ETag", `"${stat.mtimeMs}"`);
    res.sendFile(logoPath);
  };
}

app.get("/logo-chrome.png", serveRepoRootLogo("logo-chrome.png"));
app.get("/logo-dark-gray.png", serveRepoRootLogo("logo-dark-gray.png"));
app.get("/logo-gray.png", serveRepoRootLogo("logo-gray.png"));
app.get("/logo-white.png", serveRepoRootLogo("logo-white.png"));
app.get("/logo-black.png", serveRepoRootLogo("logo-black.png"));

app.get("/api/logo/dark-gray", (_req, res) => {
  const logoPath = resolve(repoRoot, "logo-dark-gray.png");
  if (!existsSync(logoPath)) {
    res.status(404).json({ error: "logo-dark-gray.png not found in repo root" });
    return;
  }
  const stat = statSync(logoPath);
  res.json({ url: `/logo-dark-gray.png?v=${stat.mtimeMs}` });
});

app.get("/api/logo/chrome", (_req, res) => {
  const logoPath = resolve(repoRoot, "logo-chrome.png");
  if (!existsSync(logoPath)) {
    res.status(404).json({ error: "logo-chrome.png not found in repo root" });
    return;
  }
  const stat = statSync(logoPath);
  res.json({ url: `/logo-chrome.png?v=${stat.mtimeMs}` });
});

app.get("/api/logo/white", (_req, res) => {
  const logoPath = resolve(repoRoot, "logo-white.png");
  if (!existsSync(logoPath)) {
    res.status(404).json({ error: "logo-white.png not found in repo root" });
    return;
  }
  const stat = statSync(logoPath);
  res.json({ url: `/logo-white.png?v=${stat.mtimeMs}` });
});

app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (/\.(html|css|js)$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }),
);
app.use("/assets/logo", express.static(join(repoRoot, "assets/logo")));

app.get("/logo", (_req, res) => {
  const transparentLogo = join(repoRoot, "assets/logo/logo-transparent.png");
  const svgLogo = join(repoRoot, "assets/logo/logo.svg");
  const legacyLogo = join(repoRoot, "logo");
  const logoPath = existsSync(transparentLogo)
    ? transparentLogo
    : existsSync(svgLogo)
      ? svgLogo
      : legacyLogo;

  if (!existsSync(logoPath)) {
    res.status(404).json({ error: "Logo not found" });
    return;
  }

  const contentType = logoPath.endsWith(".svg")
    ? "image/svg+xml"
    : logoPath.endsWith(".png")
      ? "image/png"
      : "image/jpeg";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=300");
  createReadStream(logoPath).pipe(res);
});

app.get("/logo/:variant", (req, res) => {
  const allowed = new Set([
    "black",
    "chrome",
    "off-black",
    "dark-gray",
    "gray",
    "off-white",
    "white",
    "transparent",
  ]);
  const variant = req.params.variant;
  if (!allowed.has(variant)) {
    res.status(404).json({ error: "Unknown logo variant" });
    return;
  }

  const rootPngPath = resolve(repoRoot, `logo-${variant}.png`);
  if (existsSync(rootPngPath)) {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(rootPngPath);
    return;
  }

  const pngPath = join(repoRoot, "assets/logo", `logo-${variant}.png`);
  const svgPath = join(repoRoot, "assets/logo", `logo-${variant}.svg`);
  const logoPath = existsSync(pngPath)
    ? pngPath
    : variant === "transparent"
      ? join(repoRoot, "assets/logo/logo-transparent.png")
      : existsSync(svgPath)
        ? svgPath
        : pngPath;

  if (!existsSync(logoPath)) {
    res.status(404).json({ error: "Logo variant not found" });
    return;
  }

  const contentType = logoPath.endsWith(".svg")
    ? "image/svg+xml"
    : "image/png";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=300");
  createReadStream(logoPath).pipe(res);
});

app.get("/canvas", (_req, res) => {
  res.sendFile(join(publicDir, "canvas.html"));
});

app.get("/canvas/stream", (_req, res) => {
  res.sendFile(join(publicDir, "canvas-stream.html"));
});

app.get("/canvas/record/:trackId", (_req, res) => {
  res.sendFile(join(publicDir, "canvas-record.html"));
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "dashboard" });
});

app.get("/api/status", (_req, res) => {
  const playback = getBroadcastPlayback(db);
  const libraryHealth = checkLibraryHealth(db, 10, { requireAllGenres: false });
  const readyCounts = getReadyTrackCountByGenre(db);

  let broadcastFresh = false;
  let secondsSinceUpdate: number | null = null;

  const lastActivityIso =
    playback?.state.current_phase === "dj"
      ? playback.state.dj_started_at
      : playback?.state.track_started_at;

  if (lastActivityIso) {
    const updatedMs = Date.parse(lastActivityIso);
    secondsSinceUpdate = Math.round((Date.now() - updatedMs) / 1000);
    broadcastFresh = secondsSinceUpdate <= dashboardConfig.broadcastStaleSec;
  }

  res.json({
    ok: broadcastFresh && libraryHealth.ok,
    broadcast: {
      active: Boolean(playback?.track),
      phase: playback?.state.current_phase ?? null,
      track: playback?.track
        ? {
            id: playback.track.id,
            title: playback.track.title,
            genre: playback.track.genre,
          }
        : null,
      fresh: broadcastFresh,
      secondsSinceUpdate,
    },
    library: {
      healthy: libraryHealth.ok,
      readyCounts,
      deficits: libraryHealth.deficits,
    },
    chat: {
      provider: broadcastConfig.chatProvider,
      youtubeVideoId: broadcastConfig.youtubeVideoId ?? null,
    },
    stream: {
      rtmpConfigured: Boolean(
        process.env.YOUTUBE_RTMP_URL && process.env.YOUTUBE_STREAM_KEY,
      ),
      broadcastId: process.env.YOUTUBE_BROADCAST_ID ?? null,
    },
    cdn: {
      libraryUrl: libraryConfig.libraryCdnUrl ?? null,
    },
  });
});

app.get("/api/tracks/:trackId/record", (req, res) => {
  const track = getTrackById(db, req.params.trackId);
  if (!track?.file_path || track.status !== "ready") {
    res.status(404).json({ error: "Track not found or not ready" });
    return;
  }

  const absolutePath = resolveTrackAbsolutePath(
    libraryConfig.libraryPath,
    track.file_path,
  );
  if (!existsSync(absolutePath)) {
    res.status(404).json({ error: "Audio file missing on disk" });
    return;
  }

  const title = track.display_name ?? track.title ?? "Untitled";
  const genre = track.llm_genre ?? track.genre;

  res.json({
    track: {
      id: track.id,
      title,
      genre,
      durationSec: track.duration_sec,
      energy: track.energy,
      valence: track.valence,
    },
    audioUrl: resolveTrackAudioUrl(
      track.id,
      track.file_path,
      libraryConfig.libraryCdnUrl,
    ),
  });
});

function serveAudioFile(
  req: express.Request,
  res: express.Response,
  absolutePath: string,
): void {
  const stat = statSync(absolutePath);
  const fileSize = stat.size;
  const rangeHeader = req.headers.range;

  res.setHeader("Content-Type", "audio/mpeg");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "no-cache");

  if (!rangeHeader) {
    res.setHeader("Content-Length", fileSize);
    createReadStream(absolutePath).pipe(res);
    return;
  }

  const ranges = req.range(fileSize);
  if (
    !ranges ||
    ranges === -1 ||
    ranges === -2 ||
    !Array.isArray(ranges) ||
    ranges.length === 0
  ) {
    res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
    res.end();
    return;
  }

  const { start, end } = ranges[0];
  const chunkSize = end - start + 1;

  res.status(206);
  res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
  res.setHeader("Content-Length", chunkSize);
  createReadStream(absolutePath, { start, end }).pipe(res);
}

app.get("/api/broadcast/now-playing", (_req, res) => {
  res.json(
    buildNowPlayingResponse(db, broadcastConfig, {
      libraryCdnUrl: libraryConfig.libraryCdnUrl,
    }),
  );
});

app.post("/api/broadcast/skip-to-transition", requireAdmin, (_req, res) => {
  const playback = getBroadcastPlayback(db);
  if (!playback?.track || playback.state.current_phase !== "track") {
    res.status(400).json({ error: "Skip is only available during a track" });
    return;
  }

  const durationMs = trackDurationMs(playback.track.duration_sec);
  const prepLeadMs = broadcastConfig.djPrepLeadSec * 1000;
  const startedMs = playback.state.track_started_at
    ? Date.parse(playback.state.track_started_at)
    : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedMs);
  const targetOffsetMs = skipTargetOffsetMs(
    durationMs,
    elapsedMs,
    prepLeadMs,
    moodHasPendingDj(playback.state.current_mood),
  );
  const track_started_at = trackStartIsoForOffset(targetOffsetMs);
  const nearEnd = targetOffsetMs >= durationMs - SKIP_TO_TRANSITION_LEAD_MS - 1000;

  updateBroadcastState(db, {
    track_started_at,
    skip_track: 1,
  });

  res.json({
    ok: true,
    track_started_at,
    mode: nearEnd ? "near_end" : "dj_prep",
    secondsRemaining: Math.max(0, Math.round((durationMs - targetOffsetMs) / 1000)),
  });
});

app.get("/api/playback/recent", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 15;
  res.json({ entries: getRecentPlaybackWithTracks(db, limit) });
});

app.get("/api/dj/recent", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 10;
  res.json({ entries: getRecentDjSegments(db, limit) });
});

app.get("/api/chat/recent", (req, res) => {
  const limit = req.query.limit ? Number(req.query.limit) : 50;
  res.json({
    messages: getRecentChatMessages(db, limit, { excludeSources: ["mock"] }),
  });
});

app.post("/api/chat/messages", (req, res) => {
  const username =
    typeof req.body?.username === "string" && req.body.username.trim()
      ? req.body.username.trim().slice(0, 32)
      : "you";
  const message =
    typeof req.body?.message === "string" ? req.body.message.trim() : "";

  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }

  const entry = {
    id: randomUUID(),
    username,
    message: message.slice(0, 500),
    source: "user" as const,
  };

  insertChatMessage(db, entry);
  res.status(201).json({
    message: {
      id: entry.id,
      username: entry.username,
      message: entry.message,
      timestamp: new Date().toISOString(),
    },
  });
});

app.get("/api/audio/dj/:segmentId", (req, res) => {
  const segments = getRecentDjSegments(db, 100);
  const segment = segments.find((entry) => entry.id === req.params.segmentId);

  if (!segment?.file_path) {
    res.status(404).json({ error: "DJ segment not found" });
    return;
  }

  const absolutePath = resolveDjAbsolutePath(
    broadcastConfig.djPath,
    segment.file_path,
  );

  if (!existsSync(absolutePath)) {
    res.status(404).json({ error: "DJ audio missing on disk" });
    return;
  }

  serveAudioFile(req, res, absolutePath);
});

app.get("/api/audio/:trackId", (req, res) => {
  const track = getTrackById(db, req.params.trackId);
  if (!track?.file_path) {
    res.status(404).json({ error: "Track not found" });
    return;
  }

  const absolutePath = resolveTrackAbsolutePath(
    libraryConfig.libraryPath,
    track.file_path,
  );

  if (!existsSync(absolutePath)) {
    res.status(404).json({ error: "Audio file missing on disk" });
    return;
  }

  serveAudioFile(req, res, absolutePath);
});

app.listen(port, () => {
  console.log(`Monkey Radio dashboard: http://localhost:${port}`);
});
