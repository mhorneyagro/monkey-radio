import type { SunoJobResult, SunoProvider } from "./client.js";

interface HttpSunoProviderOptions {
  baseUrl: string;
  apiKey: string;
}

interface GenerateResponse {
  job_id?: string;
  jobId?: string;
  id?: string;
}

interface JobStatusResponse {
  status?: string;
  state?: string;
  error?: string;
  message?: string;
  tracks?: Array<{
    id?: string;
    track_id?: string;
    audio_url?: string;
    audioUrl?: string;
    url?: string;
    title?: string;
    duration?: number;
    duration_sec?: number;
  }>;
  data?: {
    status?: string;
    tracks?: JobStatusResponse["tracks"];
    error?: string;
  };
}

function normalizeStatus(raw: string | undefined): SunoJobResult["status"] {
  const value = (raw ?? "").toLowerCase();
  if (["complete", "completed", "success", "done"].includes(value)) {
    return "complete";
  }
  if (["failed", "error", "cancelled", "canceled"].includes(value)) {
    return "failed";
  }
  if (["processing", "running", "in_progress", "generating"].includes(value)) {
    return "processing";
  }
  return "pending";
}

function extractJobId(data: GenerateResponse): string {
  const jobId = data.job_id ?? data.jobId ?? data.id;
  if (!jobId) {
    throw new Error("Suno API response missing job ID");
  }
  return jobId;
}

function extractTracks(
  data: JobStatusResponse,
): NonNullable<SunoJobResult["tracks"]> {
  const rawTracks = data.tracks ?? data.data?.tracks ?? [];
  return rawTracks
    .map((track) => {
      const id = track.id ?? track.track_id;
      const audioUrl = track.audio_url ?? track.audioUrl ?? track.url;
      if (!id || !audioUrl) return null;
      return {
        id,
        audioUrl,
        title: track.title ?? "Untitled",
        duration: track.duration ?? track.duration_sec ?? 0,
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
}

export class HttpSunoProvider implements SunoProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(options: HttpSunoProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
  }

  async submitGeneration(params: {
    prompt: string;
    genre: string;
    instrumental?: boolean;
  }): Promise<{ jobId: string }> {
    const response = await fetch(`${this.baseUrl}/generate`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: params.prompt,
        tags: [params.genre],
        make_instrumental: params.instrumental ?? true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Suno generate failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as GenerateResponse;
    return { jobId: extractJobId(data) };
  }

  async getJobStatus(jobId: string): Promise<SunoJobResult> {
    const response = await fetch(`${this.baseUrl}/jobs/${jobId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Suno job status failed (${response.status}): ${body}`);
    }

    const data = (await response.json()) as JobStatusResponse;
    const rawStatus = data.status ?? data.state ?? data.data?.status;
    const status = normalizeStatus(rawStatus);
    const tracks = extractTracks(data);
    const error = data.error ?? data.message ?? data.data?.error;

    return { status, tracks: tracks.length > 0 ? tracks : undefined, error };
  }
}
