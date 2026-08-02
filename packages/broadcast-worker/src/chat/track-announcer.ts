import type { BroadcastWorkerConfig, Track } from "@monkey-radio/shared";
import {
  getYouTubeAccessToken,
  loadYouTubeAuthFromEnv,
  updateLiveBroadcastNowPlaying,
} from "@monkey-radio/shared";

let cachedLiveChatId: string | undefined;
let lastAnnouncedTrackId: string | undefined;

async function fetchLiveChatId(
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

async function postLiveChatMessage(
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
    throw new Error(`YouTube liveChatMessages.insert failed (${response.status}): ${body}`);
  }
}

export async function announceTrackInLiveChat(
  config: BroadcastWorkerConfig,
  track: Track,
): Promise<void> {
  if (!track.youtube_url) return;
  if (track.id === lastAnnouncedTrackId) return;

  const auth = loadYouTubeAuthFromEnv();
  if (!auth) {
    console.warn("[chat] track announcer skipped — YouTube OAuth not configured");
    return;
  }

  const title = track.display_name ?? track.title ?? "this song";
  let didSomething = false;

  if (
    config.chatProvider === "youtube" &&
    config.youtubeVideoId &&
    config.youtubeApiKey
  ) {
    try {
      if (!cachedLiveChatId) {
        cachedLiveChatId = await fetchLiveChatId(
          config.youtubeVideoId,
          config.youtubeApiKey,
        );
      }
      if (!cachedLiveChatId) {
        console.warn("[chat] track announcer skipped — no active live chat");
      } else {
        const messageText = `🎵 Take me to this song: "${title}" ${track.youtube_url}`;
        const accessToken = await getYouTubeAccessToken(auth);
        await postLiveChatMessage(cachedLiveChatId, messageText, accessToken);
        console.log(`[chat] announced track link for "${title}"`);
        didSomething = true;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[chat] track announcer failed: ${message}`);
      if (message.includes("liveChatEnded")) {
        cachedLiveChatId = undefined;
      }
    }
  }

  const broadcastId = process.env.YOUTUBE_BROADCAST_ID;
  if (broadcastId) {
    try {
      await updateLiveBroadcastNowPlaying(auth, broadcastId, track);
      console.log(`[chat] updated live description for "${title}"`);
      didSomething = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[chat] live description update failed: ${message}`);
    }
  }

  if (didSomething) {
    lastAnnouncedTrackId = track.id;
  }
}
