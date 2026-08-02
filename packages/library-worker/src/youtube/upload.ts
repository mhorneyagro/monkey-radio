import { readFileSync, statSync } from "node:fs";
import type { Track } from "@monkey-radio/shared";
import { getYouTubeAccessToken, type YouTubeAuthConfig } from "./auth.js";

export interface UploadVideoOptions {
  auth: YouTubeAuthConfig;
  videoPath: string;
  track: Track;
  privacyStatus: "private" | "unlisted" | "public";
}

function buildDescription(track: Track): string {
  const title = track.display_name ?? track.title ?? "Untitled";
  const genre = track.llm_genre ?? track.genre;
  const lines = [
    `${title} — Monkey Radio`,
    "",
    `Style: ${genre}`,
  ];

  if (track.bpm) lines.push(`BPM: ${Math.round(track.bpm)}`);
  if (track.musical_key) lines.push(`Key: ${track.musical_key}`);

  lines.push("", "24/7 AI radio — Monkey Radio");
  return lines.join("\n");
}

function buildTags(track: Track): string[] {
  const genre = track.llm_genre ?? track.genre;
  const tags = ["Monkey Radio", "instrumental", genre];
  if (track.genre && track.genre !== genre) tags.push(track.genre);
  return [...new Set(tags.map((t) => t.slice(0, 30)))].slice(0, 10);
}

export async function uploadVideoToYouTube(
  options: UploadVideoOptions,
): Promise<string> {
  const accessToken = await getYouTubeAccessToken(options.auth);
  const title = trackTitle(options.track);
  const description = buildDescription(options.track);
  const tags = buildTags(options.track);

  const initResponse = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(statSync(options.videoPath).size),
      },
      body: JSON.stringify({
        snippet: {
          title,
          description,
          tags,
          categoryId: "10",
        },
        status: {
          privacyStatus: options.privacyStatus,
          selfDeclaredMadeForKids: false,
        },
      }),
    },
  );

  if (!initResponse.ok) {
    const body = await initResponse.text();
    throw new Error(`YouTube upload init failed (${initResponse.status}): ${body}`);
  }

  const uploadUrl = initResponse.headers.get("Location");
  if (!uploadUrl) {
    throw new Error("YouTube upload init returned no Location header");
  }

  const fileBuffer = readFileSync(options.videoPath);
  const uploadResponse = await fetch(uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(fileBuffer.length),
    },
    body: new Uint8Array(fileBuffer),
  });

  if (!uploadResponse.ok) {
    const body = await uploadResponse.text();
    throw new Error(`YouTube upload failed (${uploadResponse.status}): ${body}`);
  }

  const result = (await uploadResponse.json()) as { id?: string };
  if (!result.id) {
    throw new Error("YouTube upload succeeded but returned no video id");
  }

  return `https://www.youtube.com/watch?v=${result.id}`;
}

function trackTitle(track: Track): string {
  const name = track.display_name ?? track.title ?? "Untitled";
  return `${name} | Monkey Radio`.slice(0, 100);
}
