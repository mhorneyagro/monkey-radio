import type { BroadcastWorkerConfig, Track } from "@monkey-radio/shared";
import {
  getYouTubeOAuthAccessToken,
  handleLiveChatError,
  postLiveChatMessage,
  resolveLiveChatId,
} from "./youtube-live-chat.js";

let lastAnnouncedTrackId: string | undefined;

export async function announceTrackInLiveChat(
  config: BroadcastWorkerConfig,
  track: Track,
): Promise<void> {
  if (config.chatProvider !== "youtube") return;
  if (!track.youtube_url) return;
  if (!config.youtubeVideoId || !config.youtubeApiKey) return;
  if (track.id === lastAnnouncedTrackId) return;

  const accessToken = await getYouTubeOAuthAccessToken();
  if (!accessToken) {
    console.warn("[chat] track announcer skipped — YouTube OAuth not configured");
    return;
  }

  try {
    const liveChatId = await resolveLiveChatId(config);
    if (!liveChatId) {
      console.warn("[chat] track announcer skipped — no active live chat");
      return;
    }

    const title = track.display_name ?? track.title ?? "this song";
    const messageText = `🎵 Take me to this song: "${title}" ${track.youtube_url}`;

    await postLiveChatMessage(liveChatId, messageText, accessToken);
    lastAnnouncedTrackId = track.id;
    console.log(`[chat] announced track link for "${title}"`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[chat] track announcer failed: ${message}`);
    handleLiveChatError(message);
  }
}
