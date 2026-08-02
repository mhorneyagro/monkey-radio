import type { LibraryWorkerConfig } from "@monkey-radio/shared";
import type { SunoJobResult, SunoProvider, SunoTrack } from "../client.js";
import { clipHasAudio, clipIsFailed, toSunoTrack } from "./clips.js";
import { SunoSession } from "./session.js";
import type { SessionPaths } from "./session-store.js";
import { loadSunoCookieHeader } from "./session-store.js";
import { generateViaBrowserUI } from "./ui-generate.js";

export class BrowserSunoProvider implements SunoProvider {
  private session?: SunoSession;
  private readonly paths: SessionPaths;
  private readonly readyTracks = new Map<string, SunoTrack>();

  constructor(private readonly config: LibraryWorkerConfig) {
    this.paths = {
      storageStatePath: config.sunoBrowserStatePath,
      cookieFilePath: config.sunoCookieFilePath,
    };
  }

  private async getSession(cookieHeader?: string): Promise<SunoSession> {
    const cookie =
      cookieHeader ??
      loadSunoCookieHeader(this.config.sunoCookie, this.paths);

    if (!this.session) {
      this.session = await SunoSession.open({ cookie });
    }

    return this.session;
  }

  async verifyConnection(): Promise<void> {
    try {
      const session = await this.getSession();
      const credits = await session.getCredits();
      console.log(
        `Suno connected — ${credits.credits_left} credits left (${credits.period})`,
      );
    } catch {
      console.log("No saved Suno session — browser will open for login");
    }
  }

  async submitGeneration(params: {
    prompt: string;
    genre: string;
    instrumental?: boolean;
  }): Promise<{ jobId: string }> {
    const prompt = `${params.prompt}, ${params.genre}`;

    const result = await generateViaBrowserUI({
      prompt,
      instrumental: params.instrumental ?? true,
      submitTimeoutMs: this.config.sunoCaptchaTimeoutMs,
      renderTimeoutMs: this.config.generationTimeoutMs,
      paths: this.paths,
    });

    this.session = await SunoSession.open({ cookie: result.cookieHeader });

    const jobId = result.clipIds.join(",");
    this.readyTracks.set(jobId, result.readyTrack);

    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<SunoJobResult> {
    const cached = this.readyTracks.get(jobId);
    if (cached) {
      return { status: "complete", tracks: [cached] };
    }

    const session = await this.getSession();
    const ids = jobId.split(",").filter(Boolean);
    const clips = await session.getClips(ids);

    if (clips.length === 0) {
      return { status: "failed", error: "No clip data returned from Suno" };
    }

    const ready = clips.filter(clipHasAudio);
    if (ready.length > 0) {
      const tracks = ready.map(toSunoTrack);
      this.readyTracks.set(jobId, tracks[0]);
      return { status: "complete", tracks };
    }

    if (clips.every(clipIsFailed)) {
      return {
        status: "failed",
        error:
          clips[0]?.metadata?.error_message ??
          clips[0]?.error_message ??
          "Suno generation failed",
      };
    }

    return { status: "processing" };
  }
}
