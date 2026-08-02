#!/usr/bin/env node
import { config } from "dotenv";
import { spawn, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  loadStreamWorkerConfig,
  resolveStreamConfigPaths,
} from "@monkey-radio/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
config({ path: resolve(repoRoot, ".env"), override: true });

const CHROMIUM_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayTypes",
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--window-size=1920,1080",
  "--window-position=0,0",
  "--hide-scrollbars",
  "--disable-infobars",
  "--disable-session-crashed-bubble",
  "--force-device-scale-factor=1",
  "--disable-gpu",
];

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

function buildRtmpUrl(baseUrl: string, streamKey: string): string {
  const trimmed = baseUrl.replace(/\/+$/, "");
  const key = streamKey.replace(/^\/+/, "");
  return `${trimmed}/${key}`;
}

function spawnFfmpeg(
  config: ReturnType<typeof loadStreamWorkerConfig>,
  display: string,
  rtmpUrl: string,
): ChildProcess {
  const pulseSource = config.pulseMonitorSource;

  const args = [
    "-y",
    "-thread_queue_size",
    "512",
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
    "512",
    "-f",
    "pulse",
    "-i",
    pulseSource,
    "-c:v",
    "libx264",
    "-preset",
    config.videoPreset,
    "-tune",
    "zerolatency",
    "-pix_fmt",
    "yuv420p",
    "-b:v",
    config.videoBitrate,
    "-maxrate",
    config.videoBitrate,
    "-bufsize",
    "9000k",
    "-g",
    String(config.frameRate * 2),
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

  console.log("[stream] Starting ffmpeg → YouTube RTMP");
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
): Promise<{ context: BrowserContext; page: Page }> {
  const canvasUrl = `${dashboardUrl.replace(/\/+$/, "")}/canvas/stream`;
  console.log(`[stream] Opening ${canvasUrl} (app mode)`);

  const context = await chromium.launchPersistentContext("/tmp/chromium-stream", {
    headless: false,
    args: [...CHROMIUM_ARGS, `--app=${canvasUrl}`],
    viewport: { width: 1920, height: 1080 },
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
    }
  }

  async function start(): Promise<void> {
    await cleanup();
    const launched = await launchBrowser(dashboardUrl, display);
    context = launched.context;
    ffmpeg = spawnFfmpeg(streamConfig, display, rtmpUrl);

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
    process.exit(1);
  });
} else {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}
