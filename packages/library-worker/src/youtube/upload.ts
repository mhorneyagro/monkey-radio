import type { Track } from "@monkey-radio/shared";
import { readFileSync, statSync } from "node:fs";
import { getYouTubeAccessToken, type YouTubeAuthConfig } from "./auth.js";
import {
  buildVideoDescription,
  buildVideoTags,
  trackVideoTitle,
} from "./video-metadata.js";

export interface UploadVideoOptions {
  auth: YouTubeAuthConfig;
  videoPath: string;
  track: Track;
  privacyStatus: "private" | "unlisted" | "public";
  liveStreamUrl?: string;
}

export async function uploadVideoToYouTube(
  options: UploadVideoOptions,
): Promise<string> {
  const accessToken = await getYouTubeAccessToken(options.auth);
  const title = trackVideoTitle(options.track);
  const description = buildVideoDescription(options.track, {
    liveStreamUrl: options.liveStreamUrl,
  });
  const tags = buildVideoTags(options.track);

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
          license: "creativeCommon",
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
