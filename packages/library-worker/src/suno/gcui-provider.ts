import type { SunoJobResult, SunoProvider } from "./client.js";

interface GcuiSunoProviderOptions {
  baseUrl: string;
}

interface GcuiClip {
  id: string;
  status?: string;
  audio_url?: string;
  title?: string;
  duration?: number;
  error_message?: string;
}

function isReady(clip: GcuiClip): boolean {
  return (
    (clip.status === "streaming" ||
      clip.status === "complete" ||
      clip.status === "succeeded") &&
    Boolean(clip.audio_url)
  );
}

function isFailed(clip: GcuiClip): boolean {
  return clip.status === "error" || clip.status === "failed";
}

export class GcuiSunoProvider implements SunoProvider {
  private readonly baseUrl: string;

  constructor(options: GcuiSunoProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  async verifyConnection(): Promise<void> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/get_limit`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot reach gcui-art/suno-api at ${this.baseUrl}: ${message}\n` +
          "Start it with: npm run suno-api:up",
      );
    }

    if (!response.ok) {
      const body = await response.text();
      if (response.status === 404) {
        throw new Error(
          `${this.baseUrl} is not gcui-art/suno-api (got 404 on /api/get_limit).\n` +
            "Another app may be using this port — try SUNO_API_BASE_URL=http://localhost:3001\n" +
            "Start suno-api with: npm run suno-api:up",
        );
      }
      if (body.includes("provide a cookie") || body.includes("SUNO_COOKIE")) {
        throw new Error(
          "gcui-art/suno-api is running but has no Suno session cookie.\n\n" +
            "1. Log in to https://suno.com/create (Pro account)\n" +
            "2. DevTools → Network → refresh → copy the Cookie header from a __clerk_api_version request\n" +
            "3. Paste into infra/suno-api/.env:\n" +
            "     SUNO_COOKIE=<paste here>\n" +
            "     TWOCAPTCHA_KEY=<your 2captcha key>\n" +
            "4. Restart: npm run suno-api:down && npm run suno-api:up",
        );
      }
      throw new Error(
        `Gcui health check failed (${response.status}): ${body.slice(0, 200)}`,
      );
    }
  }

  async submitGeneration(params: {
    prompt: string;
    genre: string;
    instrumental?: boolean;
  }): Promise<{ jobId: string }> {
    const response = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt: `${params.prompt}, ${params.genre}`,
        make_instrumental: params.instrumental ?? true,
        wait_audio: false,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gcui generate failed (${response.status}): ${body}`);
    }

    const clips = (await response.json()) as GcuiClip[];
    if (!Array.isArray(clips) || clips.length === 0) {
      throw new Error("Gcui generate returned no clips");
    }

    return { jobId: clips.map((clip) => clip.id).join(",") };
  }

  async getJobStatus(jobId: string): Promise<SunoJobResult> {
    const response = await fetch(
      `${this.baseUrl}/api/get?ids=${encodeURIComponent(jobId)}`,
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Gcui get status failed (${response.status}): ${body}`);
    }

    const clips = (await response.json()) as GcuiClip[];
    if (!Array.isArray(clips) || clips.length === 0) {
      return { status: "failed", error: "Gcui returned no clip data" };
    }

    const ready = clips.filter(isReady);
    if (ready.length > 0) {
      return {
        status: "complete",
        tracks: ready.map((clip) => ({
          id: clip.id,
          audioUrl: clip.audio_url!,
          title: clip.title ?? "Untitled",
          duration: clip.duration ?? 0,
        })),
      };
    }

    if (clips.every(isFailed)) {
      return {
        status: "failed",
        error: clips[0]?.error_message ?? "Gcui generation failed",
      };
    }

    return { status: "processing" };
  }
}
