import { randomUUID } from "node:crypto";
import type { SunoJobResult, SunoProvider } from "./client.js";

interface MockJob {
  createdAt: number;
  prompt: string;
  genre: string;
}

const MOCK_PROCESSING_MS = 2_000;

export class MockSunoProvider implements SunoProvider {
  private readonly jobs = new Map<string, MockJob>();

  async submitGeneration(params: {
    prompt: string;
    genre: string;
    instrumental?: boolean;
  }): Promise<{ jobId: string }> {
    void params.instrumental;
    const jobId = randomUUID();
    this.jobs.set(jobId, {
      createdAt: Date.now(),
      prompt: params.prompt,
      genre: params.genre,
    });
    return { jobId };
  }

  async getJobStatus(jobId: string): Promise<SunoJobResult> {
    const job = this.jobs.get(jobId);
    if (!job) {
      return { status: "failed", error: `Unknown mock job: ${jobId}` };
    }

    const elapsed = Date.now() - job.createdAt;
    if (elapsed < MOCK_PROCESSING_MS) {
      return { status: "processing" };
    }

    const trackId = randomUUID();
    return {
      status: "complete",
      tracks: [
        {
          id: trackId,
          audioUrl: "mock://placeholder",
          title: `${job.genre} mock track`,
          duration: 120,
        },
      ],
    };
  }
}
