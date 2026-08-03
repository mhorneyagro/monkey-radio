import type { BroadcastWorkerConfig } from "@monkey-radio/shared";
import {
  getRecentChatMessages,
  insertChatMessage,
  type MonkeyRadioDb,
} from "@monkey-radio/shared";
import type { ChatBuffer } from "./buffer.js";
import {
  parseChatIgnoreUsernames,
  shouldIncludeChatForDj,
} from "./filter.js";

export const MOCK_CHAT_MESSAGES = [
  { username: "nightowl_42", message: "this lofi vibe is perfect for studying" },
  { username: "SynthFan99", message: "can we get some synthwave next?" },
  { username: "JazzCat", message: "jazz hour please!!" },
  { username: "chill_beans", message: "love this station, shoutout DJ Monkey" },
  { username: "ambient_dream", message: "more ambient tracks would hit" },
  { username: "funkmaster", message: "funk it up!" },
  { username: "vinyl_queen", message: "DJ Monkey you're killing it tonight" },
  { username: "beat_seeker", message: "switch to house music please" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function djChatFilterOptions(config: BroadcastWorkerConfig) {
  return {
    ignoreUsernames: parseChatIgnoreUsernames(config.chatIgnoreUsernames),
  };
}

function syncChatFromDb(
  db: MonkeyRadioDb,
  buffer: ChatBuffer,
  config: BroadcastWorkerConfig,
  limit = 100,
): void {
  const filterOptions = djChatFilterOptions(config);
  const messages = getRecentChatMessages(db, limit, { excludeSources: ["mock"] })
    .filter((message) => shouldIncludeChatForDj(message, filterOptions));
  buffer.replace(messages);
}

export function startChatPoller(
  config: BroadcastWorkerConfig,
  db: MonkeyRadioDb,
  buffer: ChatBuffer,
): { stop: () => void } {
  if (config.chatProvider === "none") {
    return { stop: () => {} };
  }

  let stopped = false;
  let pageToken: string | undefined;
  let liveChatId: string | undefined;
  const filterOptions = djChatFilterOptions(config);

  async function pollOnce(): Promise<void> {
    if (stopped) return;

    if (
      config.chatProvider === "youtube" &&
      config.youtubeVideoId &&
      config.youtubeApiKey
    ) {
      if (!liveChatId) {
        liveChatId = await fetchLiveChatId(
          config.youtubeVideoId,
          config.youtubeApiKey,
        );
        if (!liveChatId) return;
      }

      const result = await fetchYouTubeChat(
        liveChatId,
        config.youtubeApiKey,
        pageToken,
      );
      pageToken = result.nextPageToken;

      for (const message of result.messages) {
        if (
          !shouldIncludeChatForDj(message, {
            ...filterOptions,
            isChatOwner: message.isChatOwner,
          })
        ) {
          continue;
        }

        insertChatMessage(db, {
          id: message.id,
          username: message.username,
          message: message.message,
          source: "youtube",
          createdAt: message.timestamp,
        });
      }
    }

    syncChatFromDb(db, buffer, config);
  }

  void (async () => {
    while (!stopped) {
      try {
        await pollOnce();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[chat] poll failed: ${message}`);
      }
      await sleep(config.chatPollIntervalMs);
    }
  })();

  return {
    stop: () => {
      stopped = true;
    },
  };
}

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

async function fetchYouTubeChat(
  liveChatId: string,
  apiKey: string,
  pageToken?: string,
): Promise<{
  messages: Array<{
    id: string;
    username: string;
    message: string;
    timestamp: string;
    isChatOwner: boolean;
  }>;
  nextPageToken?: string;
}> {
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet,authorDetails");
  url.searchParams.set("key", apiKey);
  if (pageToken) url.searchParams.set("pageToken", pageToken);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`YouTube liveChatMessages.list failed (${response.status})`);
  }

  const data = (await response.json()) as {
    nextPageToken?: string;
    items?: Array<{
      id: string;
      snippet?: { displayMessage?: string; publishedAt?: string };
      authorDetails?: { displayName?: string; isChatOwner?: boolean };
    }>;
  };

  const messages =
    data.items?.map((item) => ({
      id: item.id,
      username: item.authorDetails?.displayName ?? "viewer",
      message: item.snippet?.displayMessage ?? "",
      timestamp: item.snippet?.publishedAt ?? new Date().toISOString(),
      isChatOwner: item.authorDetails?.isChatOwner === true,
    })) ?? [];

  return { messages, nextPageToken: data.nextPageToken };
}
