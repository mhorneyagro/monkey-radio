import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import type { LibraryWorkerConfig, Track } from "@monkey-radio/shared";
import { resolveTrackAbsolutePath } from "@monkey-radio/shared";

export interface RecordVideoOptions {
  track: Track;
  libraryPath: string;
  force?: boolean;
}

const CHROMIUM_ARGS = [
  "--autoplay-policy=no-user-gesture-required",
  "--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayTypes",
];

async function waitForDashboard(dashboardUrl: string): Promise<void> {
  try {
    const response = await fetch(`${dashboardUrl}/api/broadcast/now-playing`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) {
      throw new Error(`Dashboard returned ${response.status}`);
    }
  } catch {
    throw new Error(
      `Dashboard not reachable at ${dashboardUrl}. Start it with: npm run dashboard:dev`,
    );
  }
}

function probeAudioDurationSec(audioPath: string): number | null {
  const result = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      audioPath,
    ],
    { encoding: "utf8" },
  );

  if (result.status !== 0) {
    return null;
  }

  const duration = Number.parseFloat(result.stdout.trim());
  return Number.isFinite(duration) && duration > 0 ? duration : null;
}

function muxVideoAudio(
  videoPath: string,
  audioPath: string,
  outputPath: string,
  videoTrimSec = 0,
): void {
  const args = ["-y"];
  if (videoTrimSec > 0) {
    args.push("-ss", videoTrimSec.toFixed(3));
  }
  args.push(
    "-i",
    videoPath,
    "-i",
    audioPath,
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-pix_fmt",
    "yuv420p",
    "-shortest",
    outputPath,
  );

  const result = spawnSync("ffmpeg", args, { stdio: "inherit" });

  if (result.status !== 0) {
    throw new Error("ffmpeg mux failed — is ffmpeg installed?");
  }
}

async function launchRecordingBrowser(): Promise<Browser> {
  return chromium.launch({
    headless: true,
    args: CHROMIUM_ARGS,
  });
}

export async function recordTrackVideo(
  config: LibraryWorkerConfig,
  options: RecordVideoOptions,
): Promise<string> {
  const { track, libraryPath } = options;
  if (!track.file_path) {
    throw new Error(`Track ${track.id} has no file_path`);
  }

  mkdirSync(config.videoOutputPath, { recursive: true });
  const outputPath = join(config.videoOutputPath, `${track.id}.mp4`);

  if (!options.force && existsSync(outputPath) && statSync(outputPath).isFile()) {
    console.log(`  skip (video exists): ${outputPath}`);
    return outputPath;
  }

  await waitForDashboard(config.dashboardUrl);

  const audioPath = resolveTrackAbsolutePath(libraryPath, track.file_path);
  const probedDurationSec = probeAudioDurationSec(audioPath);
  if (!probedDurationSec) {
    throw new Error(
      `Invalid or unreadable audio file (ffprobe failed): ${audioPath}`,
    );
  }

  const durationSec = track.duration_sec ?? probedDurationSec;
  const timeoutMs = Math.ceil(durationSec * 1000) + 45_000;
  const recordUrl = `${config.dashboardUrl}/canvas/record/${track.id}`;

  console.log(`  recording ${track.display_name ?? track.title}…`);

  const browser = await launchRecordingBrowser();
  const recordDir = join(config.videoOutputPath, ".tmp", track.id);
  mkdirSync(recordDir, { recursive: true });

  const context = await browser.newContext({
    recordVideo: {
      dir: recordDir,
      size: { width: 1920, height: 1080 },
    },
    viewport: { width: 1920, height: 1080 },
  });
  const videoEpochMs = Date.now();

  const page = await context.newPage();

  try {
    await page.goto(recordUrl, { waitUntil: "load", timeout: 60_000 });
    await page.click("body");

    await page.waitForFunction(
      () => window.__RECORDING_STARTED__ === true,
      undefined,
      { timeout: 20_000 },
    );
    const syncMs = Date.now();
    const videoTrimSec = Math.max(0, (syncMs - videoEpochMs) / 1000);

    await page.waitForFunction(
      () => window.__RECORDING_DONE__ === true,
      undefined,
      { timeout: timeoutMs },
    );

    const error = await page.evaluate(() => window.__RECORDING_ERROR__);
    if (error) {
      throw new Error(String(error));
    }

    const webmPath = findNewestWebm(recordDir);
    if (!webmPath) {
      throw new Error("Playwright did not produce a video file");
    }

    console.log(`  sync trim: ${videoTrimSec.toFixed(2)}s`);
    muxVideoAudio(webmPath, audioPath, outputPath, videoTrimSec);
    cleanupDir(recordDir);

    console.log(`  saved → ${outputPath}`);
    return outputPath;
  } finally {
    await context.close();
    await browser.close();
  }
}

function findNewestWebm(dir: string): string | null {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".webm"))
    .map((f) => ({
      path: join(dir, f),
      mtime: statSync(join(dir, f)).mtimeMs,
    }))
    .sort((a, b) => b.mtime - a.mtime);

  return files[0]?.path ?? null;
}

function cleanupDir(dir: string): void {
  try {
    for (const file of readdirSync(dir)) {
      unlinkSync(join(dir, file));
    }
  } catch {
    // ignore cleanup errors
  }
}

declare global {
  interface Window {
    __RECORDING_STARTED__?: boolean;
    __RECORDING_DONE__?: boolean;
    __RECORDING_ERROR__?: string | null;
  }
}
