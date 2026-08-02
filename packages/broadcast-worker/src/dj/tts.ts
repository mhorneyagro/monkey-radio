import { execFile } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import type { BroadcastWorkerConfig } from "@monkey-radio/shared";

const execFileAsync = promisify(execFile);

function writeMockMp3(filePath: string): void {
  const header = Buffer.from([
    0xff, 0xfb, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  ]);
  writeFileSync(filePath, header);
}

function estimateSpeechDurationSec(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.min(45, Math.max(15, words * 0.45));
}

async function probeDurationSec(filePath: string): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("ffprobe", [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "csv=p=0",
      filePath,
    ]);
    const value = Number(stdout.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function synthesizeWithSay(
  script: string,
  outputPath: string,
): Promise<number> {
  const aiffPath = outputPath.replace(/\.mp3$/i, ".aiff");
  await execFileAsync("say", ["-o", aiffPath, script]);
  await execFileAsync("ffmpeg", [
    "-y",
    "-i",
    aiffPath,
    "-q:a",
    "2",
    "-acodec",
    "libmp3lame",
    outputPath,
  ]);
  unlinkSync(aiffPath);
  return (await probeDurationSec(outputPath)) ?? estimateSpeechDurationSec(script);
}

async function synthesizeWithElevenLabs(
  config: BroadcastWorkerConfig,
  script: string,
  outputPath: string,
): Promise<number> {
  if (!config.elevenLabsApiKey || !config.elevenLabsVoiceId) {
    throw new Error("ElevenLabs credentials are required");
  }

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": config.elevenLabsApiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: script,
        model_id: config.ttsModel,
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.75,
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`ElevenLabs TTS failed (${response.status}): ${body}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return (
    (await probeDurationSec(outputPath)) ?? estimateSpeechDurationSec(script)
  );
}

async function synthesizeMockTts(
  script: string,
  outputPath: string,
): Promise<number> {
  if (process.platform === "darwin") {
    try {
      return await synthesizeWithSay(script, outputPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[dj] macOS say TTS failed, falling back to silence: ${message}`);
    }
  }

  const durationSec = estimateSpeechDurationSec(script);

  try {
    await execFileAsync("ffmpeg", [
      "-y",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      String(durationSec),
      "-q:a",
      "9",
      "-acodec",
      "libmp3lame",
      outputPath,
    ]);
    return durationSec;
  } catch {
    writeMockMp3(outputPath);
    return durationSec;
  }
}

export async function synthesizeDjSegment(
  config: BroadcastWorkerConfig,
  script: string,
  segmentId: string,
): Promise<{ filePath: string; durationSec: number }> {
  mkdirSync(config.djPath, { recursive: true });

  const fileName = `${segmentId}.mp3`;
  const absolutePath = join(config.djPath, fileName);
  const relativePath = join("dj", fileName).replace(/\\/g, "/");

  const durationSec =
    config.ttsProvider === "elevenlabs"
      ? await synthesizeWithElevenLabs(config, script, absolutePath)
      : await synthesizeMockTts(script, absolutePath);

  return { filePath: relativePath, durationSec };
}
