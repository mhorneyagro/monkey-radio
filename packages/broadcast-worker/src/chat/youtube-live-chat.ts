import type { BroadcastWorkerConfig } from "@monkey-radio/shared";
import { getYouTubeAccessToken, loadYouTubeAuthFromEnv } from "@monkey-radio/shared";

let cachedLiveChatId: string | undefined;

export function clearLiveChatIdCache(): void {
  cachedLiveChatId = undefined;
}

export async function fetchLiveChatId(
  videoId: string,
  apiKey: string,
): Promise<string | undefined> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "liveStreamingDetails");
  url.searchParams.set("id", videoId);
  url.searchParams.set("key", apiKey);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube videos.list failed (${response.status})`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      liveStreamingDetails?: { activeLiveChatId?: string };
    }>;
  };

  return data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
}

export async function resolveLiveChatId(
  config: BroadcastWorkerConfig,
): Promise<string | undefined> {
  if (!config.youtubeVideoId || !config.youtubeApiKey) return undefined;

  if (!cachedLiveChatId) {
    cachedLiveChatId = await fetchLiveChatId(
      config.youtubeVideoId,
      config.youtubeApiKey,
    );
  }

  return cachedLiveChatId;
}

export async function getYouTubeOAuthAccessToken(): Promise<string | null> {
  const auth = loadYouTubeAuthFromEnv();
  if (!auth) return null;
  return getYouTubeAccessToken(auth);
}

export async function postLiveChatMessage(
  liveChatId: string,
  messageText: string,
  accessToken: string,
): Promise<void> {
  const response = await fetch(
    "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          liveChatId,
          type: "textMessageEvent",
          textMessageDetails: { messageText },
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `YouTube liveChatMessages.insert failed (${response.status}): ${body}`,
    );
  }
}

export function handleLiveChatError(message: string): void {
  if (message.includes("liveChatEnded")) {
    clearLiveChatIdCache();
  }
}
