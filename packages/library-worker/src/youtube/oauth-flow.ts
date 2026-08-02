import { createServer } from "node:http";
import { URL } from "node:url";

export const YOUTUBE_UPLOAD_SCOPE =
  "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_LIVE_SCOPE = "https://www.googleapis.com/auth/youtube";
export const YOUTUBE_FORCE_SSL_SCOPE =
  "https://www.googleapis.com/auth/youtube.force-ssl";

export const YOUTUBE_UPLOAD_SCOPES = [YOUTUBE_UPLOAD_SCOPE];
export const YOUTUBE_LIVE_SCOPES = [
  YOUTUBE_UPLOAD_SCOPE,
  YOUTUBE_LIVE_SCOPE,
  YOUTUBE_FORCE_SSL_SCOPE,
];

export function printYouTubeOAuthSetup(redirectUri: string): void {
  console.log("Google Cloud OAuth setup (required once):\n");
  console.log("1. APIs & Services → Credentials → your OAuth 2.0 Client ID");
  console.log("2. Application type must be: Web application");
  console.log("3. Under Authorized redirect URIs, add this exact URL:\n");
  console.log(`   ${redirectUri}\n`);
  console.log(
    "   (localhost and 127.0.0.1 are different — match the URL below exactly)",
  );
  console.log("4. Save, wait ~1 minute, then run this command again.\n");
}

export async function runYouTubeOAuthFlow(
  clientId: string,
  clientSecret: string,
  redirectUri = "http://localhost:8765/oauth/callback",
  scopes: string[] = YOUTUBE_UPLOAD_SCOPES,
): Promise<string> {
  const callbackUrl = new URL(redirectUri);
  const listenHost = callbackUrl.hostname;
  const listenPort = Number(callbackUrl.port || (callbackUrl.protocol === "https:" ? 443 : 80));
  const callbackPath = callbackUrl.pathname;

  if (callbackPath !== "/oauth/callback") {
    throw new Error(
      "YOUTUBE_OAUTH_REDIRECT_URI path must be /oauth/callback (e.g. http://localhost:8765/oauth/callback)",
    );
  }

  const state = crypto.randomUUID();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scopes.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);

  const refreshToken = await new Promise<string>((resolve, reject) => {
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);

      if (url.pathname !== callbackPath) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const returnedState = url.searchParams.get("state");
      const error = url.searchParams.get("error");

      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        reject(new Error(error));
        server.close();
        return;
      }

      if (!code || returnedState !== state) {
        res.writeHead(400);
        res.end("Invalid callback");
        reject(new Error("Invalid OAuth callback"));
        server.close();
        return;
      }

      try {
        const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });

        if (!tokenResponse.ok) {
          const body = await tokenResponse.text();
          throw new Error(`Token exchange failed (${tokenResponse.status}): ${body}`);
        }

        const data = (await tokenResponse.json()) as {
          refresh_token?: string;
        };

        if (!data.refresh_token) {
          throw new Error(
            "No refresh_token returned. Revoke app access in Google Account settings and retry with prompt=consent.",
          );
        }

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorized</h1><p>You can close this tab and return to the terminal.</p>",
        );

        resolve(data.refresh_token);
      } catch (err) {
        res.writeHead(500);
        res.end("Token exchange failed — see terminal");
        reject(err);
      } finally {
        server.close();
      }
    });

    server.listen(listenPort, listenHost, () => {
      printYouTubeOAuthSetup(redirectUri);
      console.log("Open this URL in your browser:\n");
      console.log(authUrl.toString());
      console.log(`\nWaiting for callback at ${redirectUri} …\n`);
    });

    server.on("error", reject);
  });

  return refreshToken;
}
