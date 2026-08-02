export {
  getYouTubeAccessToken,
  loadYouTubeAuthFromEnv,
  type YouTubeAuthConfig,
} from "@monkey-radio/shared";

export function requireYouTubeAuth(config: {
  youtubeClientId?: string;
  youtubeClientSecret?: string;
  youtubeRefreshToken?: string;
}): import("@monkey-radio/shared").YouTubeAuthConfig {
  if (
    !config.youtubeClientId ||
    !config.youtubeClientSecret ||
    !config.youtubeRefreshToken
  ) {
    throw new Error(
      "YouTube OAuth not configured. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN (run npm run library:youtube-auth)",
    );
  }

  return {
    clientId: config.youtubeClientId,
    clientSecret: config.youtubeClientSecret,
    refreshToken: config.youtubeRefreshToken,
  };
}
