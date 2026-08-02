import type { MonkeyRadioDb } from "@monkey-radio/shared";
import { updateJob } from "@monkey-radio/shared";
import type { LibraryWorkerConfig } from "@monkey-radio/shared";
import type { SunoProvider, SunoTrack } from "../suno/client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pollUntilComplete(
  db: MonkeyRadioDb,
  provider: SunoProvider,
  config: LibraryWorkerConfig,
  jobId: string,
  sunoJobId: string,
): Promise<SunoTrack> {
  const deadline = Date.now() + config.generationTimeoutMs;

  while (Date.now() < deadline) {
    updateJob(db, jobId, {
      status: "polling",
      updated_at: new Date().toISOString(),
    });

    const result = await provider.getJobStatus(sunoJobId);

    if (result.status === "complete") {
      const track = result.tracks?.[0];
      if (!track) {
        throw new Error(`Job ${sunoJobId} completed but returned no tracks`);
      }
      return track;
    }

    if (result.status === "failed") {
      throw new Error(result.error ?? `Suno job ${sunoJobId} failed`);
    }

    await sleep(config.generationPollIntervalMs);
  }

  throw new Error(
    `Suno job ${sunoJobId} timed out after ${config.generationTimeoutMs}ms`,
  );
}
