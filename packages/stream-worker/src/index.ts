#!/usr/bin/env node
import { config } from "dotenv";
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  loadStreamWorkerConfig,
  resolveStreamConfigPaths,
} from "@monkey-radio/shared";

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
config({ path: resolve(repoRoot, ".env"), override: true });

function buildChromiumArgs(width: number, height: number): string[] {
  return [
    "--autoplay-policy=no-user-gesture-required",
    "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayTypes",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    `--window-size=${width},${height}`,
    "--window-position=0,0",
    "--hide-scrollbars",
    "--disable-infobars",
    "--disable-session-crashed-bubble",
    "--force-device-scale-factor=1",
    "--disable-gpu",
    "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling",
  ];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDashboard(url: string, timeoutMs = 120_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return;
    } catch {
      // retry
    }
    await sleep(2000);
  }
  throw new Error(`Dashboard not reachable at ${url} after ${timeoutMs}ms`);
}

async function waitForDisplay(display: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await execFileAsync("xdpyinfo", ["-display", display], {
        timeout: 5000,
      });
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`X display ${display} not ready after ${timeoutMs}ms`);
}

function buildRtmpUrl(baseUrl: string, streamKey: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const key = streamKey.replace(/^\/+/, "");
  return `${trimmed}/${key}`;
}

function parseBitrateKbps(value: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?/.exec(value.trim());
  if (!match) return 2500;
  const amount = Number(match[1]);
  const unit = (match[2] ?? "k").toLowerCase();
  return unit === "m" ? amount * 1000 : amount;
}

function spawnFfmpeg(
  config: ReturnType<typeof loadStreamWorkerConfig>,
  display: string,
  rtmpUrl: string,
): ChildProcess {
  const pulseSource = config.pulseMonitorSource;
  const videoBufKbps = parseBitrateKbps(config.videoBitrate) * 2;

  const args = [
    "-y",
    "-thread_queue_size",
    "2048",
    "-f",
    "x11grab",
    "-draw_mouse",
    "0",
    "-framerate",
    String(config.frameRate),
    "-video_size",
    `${config.width}x${config.height}`,
    "-i",
    `${display}.0+0,0`,
    "-thread_queue_size",
    "2048",
    "-f",
    "pulse",
    "-sample_rate",
    "48000",
    "-channels",
    "2",
    "-i",
    pulseSource,
    "-c:v",
    "libx264",
    "-preset",
    config.videoPreset,
    "-threads",
    String(config.videoThreads),
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    config.videoBitrate,
    "-maxrate",
    config.videoBitrate,
    "-bufsize",
    `${videoBufKbps}k`,
    "-g",
    String(config.frameRate * 2),
    "-r",
    String(config.frameRate),
    "-fps_mode",
    "cfr",
    "-c:a",
    "aac",
    "-b:a",
    config.audioBitrate,
    "-ar",
    "48000",
    "-f",
    "flv",
    rtmpUrl,
  ];

  console.log(
    `[stream] Starting ffmpeg → YouTube RTMP (${config.width}x${config.height}@${config.frameRate}, ` +
      `${config.videoPreset}, ${config.videoThreads} threads)`,
  );
  const proc = spawn("ffmpeg", args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PULSE_SERVER: process.env.PULSE_SERVER,
      XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR,
    },
  });

  proc.stdout?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) console.log("[ffmpeg]", line);
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line && !line.includes("frame=")) {
      console.log("[ffmpeg]", line);
    }
  });

  return proc;
}

async function launchBrowser(
  dashboardUrl: string,
  display: string,
  width: number,
  height: number,
): Promise<{ context: BrowserContext; page: Page }> {
  const canvasUrl = `${dashboardUrl.replace(/\/+$/, "")}/canvas/stream`;
  console.log(`[stream] Opening ${canvasUrl} (app mode)`);

  await waitForDisplay(display);

  const context = await chromium.launchPersistentContext("/tmp/chromium-stream", {
    headless: false,
    args: [...buildChromiumArgs(width, height), `--app=${canvasUrl}`],
    viewport: { width, height },
    ignoreDefaultArgs: ["--enable-automation"],
    env: {
      ...process.env,
      DISPLAY: display,
    },
  });

  const page = context.pages()[0] ?? (await context.newPage());
  if (page.url() === "about:blank") {
    await page.goto(canvasUrl, { waitUntil: "networkidle" });
  }

  await page.bringToFront();

  page.on("console", (msg) => {
    const text = msg.text();
    if (text.includes("[stream]")) {
      console.log(`[canvas] ${text}`);
    }
  });

  // Wait for stream-ready signal from canvas
  await page.waitForFunction(
    () => (window as unknown as { __STREAM_READY__?: boolean }).__STREAM_READY__ === true,
    { timeout: 60_000 },
  );

  await page.evaluate(() => {
    for (const audio of document.querySelectorAll("audio")) {
      audio.muted = false;
      audio.volume = 1;
    }
  });

  console.log("[stream] Canvas audio synced and ready");
  return { context, page };
}

interface StreamAudioProbe {
  level: number;
  playing: boolean;
  suspended: boolean;
}

async function probeStreamAudio(page: Page): Promise<StreamAudioProbe> {
  return page.evaluate(() => {
    const measure = (
      window as unknown as {
        __measureStreamAudio__?: () => StreamAudioProbe;
      }
    ).__measureStreamAudio__;
    return measure?.() ?? { level: 0, playing: false, suspended: false };
  });
}

async function isBroadcastPlayingMusic(dashboardUrl: string): Promise<boolean> {
  try {
    const response = await fetch(
      `${dashboardUrl.replace(/\/+$/, "")}/api/broadcast/now-playing`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { playing?: boolean; phase?: string };
    return data.playing === true && data.phase === "track";
  } catch {
    return false;
  }
}

function startAudioHealthMonitor(
  getPage: () => Page | null,
  dashboardUrl: string,
  onSilent: () => void,
): void {
  const SILENT_LEVEL = 2;
  const SILENT_STREAK_LIMIT = 3;
  const CHECK_INTERVAL_MS = 20_000;
  let silentStreak = 0;

  void (async () => {
    while (true) {
      await sleep(CHECK_INTERVAL_MS);
      const page = getPage();
      if (!page) {
        silentStreak = 0;
        continue;
      }

      try {
        const shouldHaveMusic = await isBroadcastPlayingMusic(dashboardUrl);
        if (!shouldHaveMusic) {
          silentStreak = 0;
          continue;
        }

        const audio = await probeStreamAudio(page);
        if (audio.level >= SILENT_LEVEL) {
          silentStreak = 0;
          continue;
        }

        silentStreak += 1;
        console.warn(
          `[stream] silent audio (${silentStreak}/${SILENT_STREAK_LIMIT}, ` +
            `level=${audio.level.toFixed(1)}, suspended=${audio.suspended})`,
        );

        if (silentStreak >= SILENT_STREAK_LIMIT) {
          silentStreak = 0;
          onSilent();
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[stream] audio health check failed: ${message}`);
      }
    }
  })();
}

async function runStreamLoop(): Promise<void> {
  const streamConfig = resolveStreamConfigPaths(loadStreamWorkerConfig(), repoRoot);

  if (!streamConfig.youtubeRtmpUrl || !streamConfig.youtubeStreamKey) {
    throw new Error(
      "YouTube RTMP not configured. Set YOUTUBE_RTMP_URL and YOUTUBE_STREAM_KEY " +
        "(run: npm run youtube:live-create)",
    );
  }

  const dashboardUrl = streamConfig.dashboardUrl;
  await waitForDashboard(dashboardUrl);

  const rtmpUrl = buildRtmpUrl(
    streamConfig.youtubeRtmpUrl!,
    streamConfig.youtubeStreamKey!,
  );

  const display = streamConfig.display;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let ffmpeg: ChildProcess | null = null;
  let restarting = false;

  console.log(
    `[stream] display=${display} pulse=${process.env.PULSE_SERVER ?? "default"} ` +
      `source=${streamConfig.pulseMonitorSource}`,
  );

  async function cleanup(): Promise<void> {
    if (ffmpeg && !ffmpeg.killed) {
      ffmpeg.kill("SIGTERM");
      ffmpeg = null;
    }
    if (context) {
      await context.close().catch(() => {});
      context = null;
      page = null;
    }
  }

  async function start(): Promise<void> {
    await cleanup();
    const launched = await launchBrowser(
      dashboardUrl,
      display,
      streamConfig.width,
      streamConfig.height,
    );
    context = launched.context;
    page = launched.page;
    ffmpeg = spawnFfmpeg(streamConfig, display, rtmpUrl);

    startAudioHealthMonitor(
      () => page,
      dashboardUrl,
      () => {
        if (!restarting) void restart("silent audio");
      },
    );

    ffmpeg.on("exit", (code, signal) => {
      console.warn(`[stream] ffmpeg exited (code=${code}, signal=${signal})`);
      if (!restarting) {
        void restart("ffmpeg exit");
      }
    });
  }

  async function restart(reason: string): Promise<void> {
    if (restarting) return;
    restarting = true;
    console.warn(`[stream] Restarting (${reason}) in 5s…`);
    await sleep(5000);
    restarting = false;
    try {
      await start();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[stream] Restart failed: ${message}`);
      void restart("start failure");
    }
  }

  process.on("SIGINT", () => {
    console.log("\n[stream] Shutting down…");
    restarting = true;
    void cleanup().then(() => process.exit(0));
  });

  process.on("SIGTERM", () => {
    restarting = true;
    void cleanup().then(() => process.exit(0));
  });

  await start();

  // Keep process alive — ffmpeg exit handler triggers restart
  await new Promise<void>(() => {});
}

const command = process.argv[2];
if (command === "start" || !command) {
  runStreamLoop().catch((error) => {
    console.error("[stream] Fatal:", error instanceof Error ? error.message : error);
    console.warn("[stream] Retrying in 10s…");
    setTimeout(() => {
      runStreamLoop().catch((retryError) => {
        console.error(
          "[stream] Fatal (retry):",
          retryError instanceof Error ? retryError.message : retryError,
        );
        process.exit(1);
      });
    }, 10_000);
  });
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
