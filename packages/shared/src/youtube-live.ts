import type { YouTubeAuthConfig } from "./youtube-auth.js";
import { getYouTubeAccessToken } from "./youtube-auth.js";

const YOUTUBE_API = "https://www.googleapis.com/youtube/v3";
export const NOW_PLAYING_MARKER = "\n\n🎵 NOW PLAYING\n";

export function stripNowPlayingBlock(description: string): string {
  const idx = description.indexOf(NOW_PLAYING_MARKER);
  if (idx === -1) return description.trimEnd();
  return description.slice(0, idx).trimEnd();
}

export function appendNowPlayingBlock(
  baseDescription: string,
  track: { title?: string | null; display_name?: string | null; youtube_url?: string | null },
): string {
  const title = track.display_name ?? track.title ?? "Unknown";
  let block = `${NOW_PLAYING_MARKER}"${title}"`;
  if (track.youtube_url) {
    block += `\n${track.youtube_url}\n\nLink also posted in live chat ↑`;
  }
  return `${stripNowPlayingBlock(baseDescription)}${block}`;
}

async function youtubeFetch<T>(
  path: string,
  accessToken: string,
  options: RequestInit = {},
): Promise<T> {
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

export async function updateLiveBroadcastNowPlaying(
  auth: YouTubeAuthConfig,
  broadcastId: string,
  track: { title?: string | null; display_name?: string | null; youtube_url?: string | null },
): Promise<void> {
  const accessToken = await getYouTubeAccessToken(auth);

  const current = await youtubeFetch<{
    items?: Array<{
      id: string;
      snippet?: {
        title?: string;
        description?: string;
        scheduledStartTime?: string;
      };
    }>;
  }>(`/liveBroadcasts?part=snippet&id=${broadcastId}`, accessToken);

  const item = current.items?.[0];
  if (!item?.snippet) {
    throw new Error(`Broadcast not found: ${broadcastId}`);
  }

  const description = appendNowPlayingBlock(
    item.snippet.description ?? "",
    track,
  );

  await youtubeFetch<{ id: string }>(
    `/liveBroadcasts?part=snippet`,
    accessToken,
    {
      method: "PUT",
      body: JSON.stringify({
        id: broadcastId,
        snippet: {
          title: item.snippet.title,
          description,
          scheduledStartTime: item.snippet.scheduledStartTime,
        },
      }),
    },
  );
}
