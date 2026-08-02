import type { Track } from "@monkey-radio/shared";
import { getYouTubeAccessToken, type YouTubeAuthConfig } from "./auth.js";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";

export const ROYALTY_FREE_MARKER = "ROYALTY-FREE MUSIC";

export const ROYALTY_FREE_NOTICE = `---
🎵 ROYALTY-FREE MUSIC
This instrumental is free to use in your videos, streams, podcasts, and projects under the Creative Commons license.
Credit appreciated: Monkey Radio`;

export interface YouTubeVideoRecord {
  id: string;
  snippet: {
    title: string;
    description: string;
    categoryId: string;
    tags?: string[];
  };
  status: {
    privacyStatus: string;
    license: string;
    embeddable?: boolean;
    publicStatsViewable?: boolean;
    selfDeclaredMadeForKids?: boolean;
  };
}

async function youtubeFetch<T>(
  path: string,
  auth: YouTubeAuthConfig,
  options: RequestInit = {},
): Promise<T> {
  const accessToken = await getYouTubeAccessToken(auth);
  const response = await fetch(`${YOUTUBE_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube API ${path} failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

export function buildVideoDescription(
  track: Track,
  options: { liveStreamUrl?: string; existingDescription?: string } = {},
): string {
  const title = track.display_name ?? track.title ?? "Untitled";
  const genre = track.llm_genre ?? track.genre;
  const lines = [`${title} — Monkey Radio`, "", `Style: ${genre}`];

  if (track.bpm) lines.push(`BPM: ${Math.round(track.bpm)}`);
  if (track.musical_key) lines.push(`Key: ${track.musical_key}`);

  lines.push("", ROYALTY_FREE_NOTICE);

  if (options.liveStreamUrl) {
    lines.push("", `Listen live 24/7: ${options.liveStreamUrl}`);
  }

  return lines.join("\n");
}

export function mergeRoyaltyFreeDescription(
  existingDescription: string,
  _track: Track,
  options: { liveStreamUrl?: string } = {},
): string {
  if (existingDescription.includes(ROYALTY_FREE_MARKER)) {
    return existingDescription;
  }

  const lines = [existingDescription.trim(), "", ROYALTY_FREE_NOTICE];
  if (options.liveStreamUrl) {
    lines.push("", `Listen live 24/7: ${options.liveStreamUrl}`);
  }
  return lines.join("\n").trim();
}

export async function fetchYouTubeVideos(
  auth: YouTubeAuthConfig,
  videoIds: string[],
): Promise<Map<string, YouTubeVideoRecord>> {
  const results = new Map<string, YouTubeVideoRecord>();
  if (videoIds.length === 0) return results;

  for (let index = 0; index < videoIds.length; index += 50) {
    const chunk = videoIds.slice(index, index + 50);
    const data = await youtubeFetch<{
      items?: YouTubeVideoRecord[];
    }>(
      `/videos?part=snippet,status&id=${chunk.map(encodeURIComponent).join(",")}`,
      auth,
    );

    for (const item of data.items ?? []) {
      results.set(item.id, item);
    }
  }

  return results;
}

export async function updateYouTubeVideoMetadata(
  auth: YouTubeAuthConfig,
  video: YouTubeVideoRecord,
  updates: {
    description?: string;
    license?: "creativeCommon" | "youtube";
  },
): Promise<YouTubeVideoRecord> {
  const body = {
    id: video.id,
    snippet: {
      title: video.snippet.title,
      description: updates.description ?? video.snippet.description,
      categoryId: video.snippet.categoryId,
      tags: video.snippet.tags,
    },
    status: {
      privacyStatus: video.status.privacyStatus,
      license: updates.license ?? video.status.license,
      embeddable: video.status.embeddable ?? true,
      publicStatsViewable: video.status.publicStatsViewable ?? true,
      selfDeclaredMadeForKids: video.status.selfDeclaredMadeForKids ?? false,
    },
  };

  return youtubeFetch<YouTubeVideoRecord>(
    `/videos?part=snippet,status`,
    auth,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
}

export function buildVideoTags(track: Track): string[] {
  const genre = track.llm_genre ?? track.genre;
  const tags = [
    "Monkey Radio",
    "royalty free music",
    "Creative Commons",
    "instrumental",
    genre,
  ];
  if (track.genre && track.genre !== genre) tags.push(track.genre);
  return [...new Set(tags.map((tag) => tag.slice(0, 30)))].slice(0, 10);
}

export function trackVideoTitle(track: Track): string {
  const name = track.display_name ?? track.title ?? "Untitled";
  return `${name} | Monkey Radio`.slice(0, 100);
}
