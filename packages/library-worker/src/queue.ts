import type { LibraryWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import {
  claimNextQueuedJob,
  countPendingJobs,
  getJobById,
  updateJob,
  updateTrack,
} from "@monkey-radio/shared";
import { downloadTrack } from "./pipeline/download.js";
import { submitGeneration } from "./pipeline/generate.js";
import { pollUntilComplete } from "./pipeline/poll.js";
import type { SunoProvider } from "./suno/client.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return Math.min(2 ** attempt * 1000, 30_000);
}

async function processJob(
  db: MonkeyRadioDb,
  provider: SunoProvider,
  config: LibraryWorkerConfig,
  jobId: string,
): Promise<void> {
  const job = getJobById(db, jobId);
  if (!job?.track_id) {
    throw new Error(`Invalid job: ${jobId}`);
  }

  const sunoJobId = await submitGeneration(db, provider, config, jobId);
  const sunoTrack = await pollUntilComplete(
    db,
    provider,
    config,
    jobId,
    sunoJobId,
  );

  await downloadTrack(db, config, {
    trackId: job.track_id,
    genre: job.genre,
    sunoTrack,
  });

  updateJob(db, jobId, {
    status: "done",
    updated_at: new Date().toISOString(),
  });
}

async function handleJobFailure(
  db: MonkeyRadioDb,
  config: LibraryWorkerConfig,
  jobId: string,
  error: unknown,
): Promise<void> {
  const job = getJobById(db, jobId);
  if (!job) return;

  const message = error instanceof Error ? error.message : String(error);
  const attempts = job.attempts + 1;
  const now = new Date().toISOString();

  if (attempts < config.maxRetries) {
    console.error(
      `[job ${jobId}] failed (attempt ${attempts}/${config.maxRetries}): ${message} — retrying`,
    );
    updateJob(db, jobId, {
      status: "queued",
      attempts,
      updated_at: now,
    });
    if (job.track_id) {
      updateTrack(db, job.track_id, {
        status: "pending",
        error: message,
      });
    }
    await sleep(backoffMs(attempts));
    return;
  }

  console.error(
    `[job ${jobId}] failed permanently after ${attempts} attempts: ${message}`,
  );
  updateJob(db, jobId, {
    status: "failed",
    attempts,
    updated_at: now,
  });
  if (job.track_id) {
    updateTrack(db, job.track_id, {
      status: "failed",
      error: message,
    });
  }
}

export async function processQueue(
  db: MonkeyRadioDb,
  provider: SunoProvider,
  config: LibraryWorkerConfig,
): Promise<void> {
  const active = new Set<Promise<void>>();

  while (true) {
    while (active.size < config.maxConcurrentGenerations) {
      const job = claimNextQueuedJob(db);
      if (!job) break;

      const task = processJob(db, provider, config, job.id)
        .catch((error) => handleJobFailure(db, config, job.id, error))
        .finally(() => {
          active.delete(task);
        });

      active.add(task);
    }

    if (active.size === 0 && countPendingJobs(db) === 0) {
      break;
    }

    if (active.size > 0) {
      await Promise.race(active);
    } else {
      await sleep(500);
    }
  }

  await Promise.all(active);
}

export async function processSingleJob(
  db: MonkeyRadioDb,
  provider: SunoProvider,
  config: LibraryWorkerConfig,
  jobId: string,
): Promise<void> {
  try {
    await processJob(db, provider, config, jobId);
  } catch (error) {
    await handleJobFailure(db, config, jobId, error);
  }
}
