import { resolve } from "node:path";
import { z } from "zod";

const libraryWorkerConfigSchema = z.object({
  sunoApiBaseUrl: z.string().url().optional(),
  sunoApiKey: z.string().optional(),
  sunoProvider: z.enum(["browser", "gcui", "http", "mock"]).default("browser"),
  sunoCookie: z.string().optional(),
  sunoCookieFilePath: z.string().default("./data/suno-cookie.txt"),
  sunoBrowserStatePath: z.string().default("./data/suno-browser-state.json"),
  sunoBrowserHeadless: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  sunoCaptchaTimeoutMs: z.coerce.number().int().positive().default(180_000),
  libraryPath: z.string().default("./data/library"),
  databasePath: z.string().default("./data/monkey-radio.db"),
  tracksPerGenre: z.coerce.number().int().positive().default(20),
  maxConcurrentGenerations: z.coerce.number().int().positive().default(2),
  generationPollIntervalMs: z.coerce.number().int().positive().default(10_000),
  generationTimeoutMs: z.coerce.number().int().positive().default(300_000),
  preferInstrumental: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  maxRetries: z.coerce.number().int().positive().default(3),
  stagingPath: z.string().default("./data/staging/songs"),
  openaiApiKey: z.string().optional(),
  llmModel: z.string().default("gpt-4o-mini"),
  elevenLabsApiKey: z.string().optional(),
  musicLengthMs: z.coerce.number().int().positive().default(120_000),
  musicModelId: z.string().default("music_v2"),
  videoOutputPath: z.string().default("./data/videos"),
  dashboardUrl: z.string().url().default("http://localhost:5400"),
  youtubeClientId: z.string().optional(),
  youtubeClientSecret: z.string().optional(),
  youtubeRefreshToken: z.string().optional(),
  youtubeOAuthRedirectUri: z
    .string()
    .url()
    .default("http://localhost:8765/oauth/callback"),
  youtubeVideoPrivacy: z
    .enum(["private", "unlisted", "public"])
    .default("unlisted"),
  libraryCdnUrl: z.string().url().optional(),
});

export type LibraryWorkerConfig = z.infer<typeof libraryWorkerConfigSchema>;

export function loadLibraryWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): LibraryWorkerConfig {
  return libraryWorkerConfigSchema.parse({
    sunoApiBaseUrl: env.SUNO_API_BASE_URL,
    sunoApiKey: env.SUNO_API_KEY,
    sunoProvider: env.SUNO_PROVIDER ?? "browser",
    sunoCookie: env.SUNO_COOKIE,
    sunoCookieFilePath: env.SUNO_COOKIE_FILE,
    sunoBrowserStatePath: env.SUNO_BROWSER_STATE,
    sunoBrowserHeadless: env.SUNO_BROWSER_HEADLESS,
    sunoCaptchaTimeoutMs: env.SUNO_CAPTCHA_TIMEOUT_MS,
    libraryPath: env.LIBRARY_PATH,
    databasePath: env.DATABASE_PATH,
    tracksPerGenre: env.TRACKS_PER_GENRE,
    maxConcurrentGenerations: env.MAX_CONCURRENT_GENERATIONS,
    generationPollIntervalMs: env.GENERATION_POLL_INTERVAL_MS,
    generationTimeoutMs: env.GENERATION_TIMEOUT_MS,
    preferInstrumental: env.PREFER_INSTRUMENTAL,
    maxRetries: env.MAX_RETRIES,
    stagingPath: env.STAGING_PATH,
    openaiApiKey: env.OPENAI_API_KEY,
    llmModel: env.LLM_MODEL,
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    musicLengthMs: env.MUSIC_LENGTH_MS,
    musicModelId: env.MUSIC_MODEL_ID,
    videoOutputPath: env.VIDEO_OUTPUT_PATH,
    dashboardUrl: env.DASHBOARD_URL,
    youtubeClientId: env.YOUTUBE_CLIENT_ID,
    youtubeClientSecret: env.YOUTUBE_CLIENT_SECRET,
    youtubeRefreshToken: env.YOUTUBE_REFRESH_TOKEN,
    youtubeOAuthRedirectUri: env.YOUTUBE_OAUTH_REDIRECT_URI,
    youtubeVideoPrivacy: env.YOUTUBE_VIDEO_PRIVACY,
    libraryCdnUrl: env.LIBRARY_CDN_URL,
  });
}

export function resolveConfigPaths(
  config: LibraryWorkerConfig,
  repoRoot: string,
): LibraryWorkerConfig {
  return {
    ...config,
    libraryPath: resolve(repoRoot, config.libraryPath),
    databasePath: resolve(repoRoot, config.databasePath),
    sunoCookieFilePath: resolve(repoRoot, config.sunoCookieFilePath),
    sunoBrowserStatePath: resolve(repoRoot, config.sunoBrowserStatePath),
    stagingPath: resolve(repoRoot, config.stagingPath),
    videoOutputPath: resolve(repoRoot, config.videoOutputPath),
  };
}

const broadcastWorkerConfigSchema = z.object({
  libraryPath: z.string().default("./data/library"),
  databasePath: z.string().default("./data/monkey-radio.db"),
  djPath: z.string().default("./data/dj"),
  defaultGenre: z.string().default("lofi"),
  avoidReplayLimit: z.coerce.number().int().positive().default(50),
  crossfadeSec: z.coerce.number().int().nonnegative().default(5),
  minLibraryPerGenre: z.coerce.number().int().positive().default(10),
  openaiApiKey: z.string().optional(),
  llmModel: z.string().default("gpt-4o-mini"),
  llmProvider: z.enum(["openai", "mock"]).optional(),
  elevenLabsApiKey: z.string().optional(),
  elevenLabsVoiceId: z.string().optional(),
  ttsProvider: z.enum(["elevenlabs", "mock"]).optional(),
  ttsModel: z.string().default("eleven_turbo_v2_5"),
  youtubeVideoId: z.string().optional(),
  youtubeApiKey: z.string().optional(),
  chatProvider: z.enum(["mock", "youtube", "none"]).default("mock"),
  chatPollIntervalMs: z.coerce.number().int().positive().default(5000),
  chatWindowMs: z.coerce.number().int().positive().default(300_000),
  minTracksBeforeDj: z.coerce.number().int().positive().default(1),
  djMinIntervalSec: z.coerce.number().int().positive().default(120),
  djPrepLeadSec: z.coerce.number().int().positive().default(30),
});

export type BroadcastWorkerConfig = z.infer<typeof broadcastWorkerConfigSchema>;

function resolveProvider<T extends string>(
  explicit: T | undefined,
  hasCredentials: boolean,
  credentialed: T,
  fallback: T,
): T {
  if (explicit) return explicit;
  return hasCredentials ? credentialed : fallback;
}

export function loadBroadcastWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): BroadcastWorkerConfig {
  const parsed = broadcastWorkerConfigSchema.parse({
    libraryPath: env.LIBRARY_PATH,
    databasePath: env.DATABASE_PATH,
    djPath: env.DJ_PATH,
    defaultGenre: env.DEFAULT_GENRE,
    avoidReplayLimit: env.AVOID_REPLAY_LIMIT,
    crossfadeSec: env.CROSSFADE_SEC,
    minLibraryPerGenre: env.MIN_LIBRARY_PER_GENRE,
    openaiApiKey: env.OPENAI_API_KEY,
    llmModel: env.LLM_MODEL,
    llmProvider: env.LLM_PROVIDER,
    elevenLabsApiKey: env.ELEVENLABS_API_KEY,
    elevenLabsVoiceId: env.ELEVENLABS_VOICE_ID,
    ttsProvider: env.TTS_PROVIDER,
    ttsModel: env.ELEVENLABS_MODEL,
    youtubeVideoId: env.YOUTUBE_VIDEO_ID,
    youtubeApiKey: env.YOUTUBE_API_KEY,
    chatProvider: env.CHAT_PROVIDER,
    chatPollIntervalMs: env.CHAT_POLL_INTERVAL_MS,
    chatWindowMs: env.CHAT_WINDOW_MS,
    minTracksBeforeDj: env.MIN_TRACKS_BEFORE_DJ,
    djMinIntervalSec: env.DJ_MIN_INTERVAL_SEC,
    djPrepLeadSec: env.DJ_PREP_LEAD_SEC,
  });

  return {
    ...parsed,
    llmProvider: resolveProvider(
      parsed.llmProvider,
      Boolean(parsed.openaiApiKey),
      "openai",
      "mock",
    ),
    ttsProvider: resolveProvider(
      parsed.ttsProvider,
      Boolean(parsed.elevenLabsApiKey && parsed.elevenLabsVoiceId),
      "elevenlabs",
      "mock",
    ),
    chatProvider:
      parsed.chatProvider === "youtube" &&
      parsed.youtubeVideoId &&
      parsed.youtubeApiKey
        ? "youtube"
        : parsed.chatProvider === "none"
          ? "none"
          : parsed.chatProvider === "mock"
            ? "mock"
            : "mock",
  };
}

export function resolveBroadcastConfigPaths(
  config: BroadcastWorkerConfig,
  repoRoot: string,
): BroadcastWorkerConfig {
  return {
    ...config,
    libraryPath: resolve(repoRoot, config.libraryPath),
    databasePath: resolve(repoRoot, config.databasePath),
    djPath: resolve(repoRoot, config.djPath),
  };
}

const streamWorkerConfigSchema = z.object({
  dashboardUrl: z.string().url().default("http://localhost:5400"),
  youtubeRtmpUrl: z.string().optional(),
  youtubeStreamKey: z.string().optional(),
  display: z.string().default(":99"),
  pulseMonitorSource: z.string().default("stream_sink.monitor"),
  width: z.coerce.number().int().positive().default(1920),
  height: z.coerce.number().int().positive().default(1080),
  frameRate: z.coerce.number().int().positive().default(30),
  videoBitrate: z.string().default("4500k"),
  audioBitrate: z.string().default("192k"),
  videoPreset: z.string().default("faster"),
});

export type StreamWorkerConfig = z.infer<typeof streamWorkerConfigSchema>;

export function loadStreamWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): StreamWorkerConfig {
  return streamWorkerConfigSchema.parse({
    dashboardUrl: env.DASHBOARD_URL,
    youtubeRtmpUrl: env.YOUTUBE_RTMP_URL,
    youtubeStreamKey: env.YOUTUBE_STREAM_KEY,
    display: env.STREAM_DISPLAY,
    pulseMonitorSource: env.STREAM_PULSE_MONITOR,
    width: env.STREAM_WIDTH,
    height: env.STREAM_HEIGHT,
    frameRate: env.STREAM_FRAME_RATE,
    videoBitrate: env.STREAM_VIDEO_BITRATE,
    audioBitrate: env.STREAM_AUDIO_BITRATE,
    videoPreset: env.STREAM_VIDEO_PRESET,
  });
}

export function resolveStreamConfigPaths(
  config: StreamWorkerConfig,
  repoRoot: string,
): StreamWorkerConfig {
  return config;
}

const dashboardConfigSchema = z.object({
  port: z.coerce.number().int().positive().default(5400),
  adminApiKey: z.string().optional(),
  broadcastStaleSec: z.coerce.number().int().positive().default(300),
  libraryCdnUrl: z.string().url().optional(),
});

export type DashboardConfig = z.infer<typeof dashboardConfigSchema>;

export function loadDashboardConfig(
  env: NodeJS.ProcessEnv = process.env,
): DashboardConfig {
  return dashboardConfigSchema.parse({
    port: env.PORT ?? env.DASHBOARD_PORT,
    adminApiKey: env.ADMIN_API_KEY,
    broadcastStaleSec: env.BROADCAST_STALE_SEC,
    libraryCdnUrl: env.LIBRARY_CDN_URL,
  });
}
