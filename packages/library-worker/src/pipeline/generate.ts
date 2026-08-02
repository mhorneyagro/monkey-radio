import type { MonkeyRadioDb } from "@monkey-radio/shared";
import { getJobById, updateJob, updateTrack } from "@monkey-radio/shared";
import type { LibraryWorkerConfig } from "@monkey-radio/shared";
import type { SunoProvider } from "../suno/client.js";

export async function submitGeneration(
  db: MonkeyRadioDb,
  provider: SunoProvider,
  config: LibraryWorkerConfig,
  jobId: string,
): Promise<string> {
  const job = getJobById(db, jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  if (!job.track_id) {
    throw new Error(`Job ${jobId} has no associated track`);
  }

  const result = await provider.submitGeneration({
    prompt: job.prompt,
    genre: job.genre,
    instrumental: config.preferInstrumental,
  });

  const now = new Date().toISOString();
  updateJob(db, jobId, {
    suno_job_id: result.jobId,
    updated_at: now,
  });
  updateTrack(db, job.track_id, {
    suno_job_id: result.jobId,
    status: "generating",
    error: null,
  });

  return result.jobId;
}
