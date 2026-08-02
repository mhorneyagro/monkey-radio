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

export function loadYouTubeAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): YouTubeAuthConfig | null {
  const clientId = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  return { clientId, clientSecret, refreshToken };
}
