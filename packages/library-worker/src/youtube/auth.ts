export interface YouTubeAuthConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export async function getYouTubeAccessToken(
  config: YouTubeAuthConfig,
): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube token refresh failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error("YouTube token refresh returned no access_token");
  }

  return data.access_token;
}

export function requireYouTubeAuth(config: {
  youtubeClientId?: string;
  youtubeClientSecret?: string;
  youtubeRefreshToken?: string;
}): YouTubeAuthConfig {
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
