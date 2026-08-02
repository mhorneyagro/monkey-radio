#!/usr/bin/env node
import { config } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
config({ path: resolve(repoRoot, ".env"), override: true });

import { Command } from "commander";
import {
  checkLibraryHealth,
  getFailedJobs,
  getReadyTrackCountByGenre,
  getTrackCountsByGenreAndStatus,
  loadLibraryWorkerConfig,
  openDatabase,
  requeueFailedJob,
  resolveConfigPaths,
} from "@monkey-radio/shared";
import { createSunoProvider } from "./suno/client.js";
import { fillLibrary, resolveGenres } from "./scheduler.js";
import { processQueue } from "./queue.js";
import { resolveSeedGenres, seedLibraryFromArchive } from "./seed/seed-library.js";
import {
  importFromAnalysis,
} from "./seed/import-analysis.js";
import {
  importYouTubeChannel,
  resolveImportGenre,
} from "./seed/youtube-channel.js";
import {
  resolveSunoLoginPaths,
  runSunoLogin,
} from "./suno/browser/login.js";
import { generateToStaging } from "./pipeline/staging-generate.js";
import { nameTracksFromAnalysis } from "./pipeline/name-tracks.js";
import { processStaging } from "./pipeline/process-staging.js";
import {
  publishTracksToYouTube,
  recordTrackVideos,
  uploadTrackVideos,
} from "./pipeline/publish-youtube.js";
import { removeTrack } from "./remove-track.js";
import { runYouTubeOAuthFlow, YOUTUBE_LIVE_SCOPES } from "./youtube/oauth-flow.js";
import { requireYouTubeAuth } from "./youtube/auth.js";
import {
  createLiveBroadcast,
  getLiveBroadcastStatus,
  listActiveBroadcasts,
  transitionBroadcastToLive,
  updateLiveBroadcast,
} from "./youtube/live.js";

const program = new Command();

function loadConfig() {
  return resolveConfigPaths(loadLibraryWorkerConfig(), repoRoot);
}

program
  .name("library-worker")
  .description("Monkey Radio library worker — generate and store tracks");

program
  .command("generate")
  .description(
    "Generate instrumental tracks via LLM genre pick + ElevenLabs Music API into staging",
  )
  .option("--count <n>", "Number of tracks to generate", "1")
  .action(async (options: { count: string }) => {
    const config = loadConfig();
    await generateToStaging(config, { count: Number(options.count) });
  });

program
  .command("name-tracks")
  .description("Generate unique display names for analyzed staging tracks")
  .option(
    "--analysis <path>",
    "Path to analysis.json",
    "./data/staging/songs/analysis.json",
  )
  .option("--force", "Regenerate names even if names.json already has entries")
  .action(async (options: { analysis: string; force?: boolean }) => {
    const config = loadConfig();
    const analysisPath = resolve(repoRoot, options.analysis);

    await nameTracksFromAnalysis(config, {
      analysisPath,
      databasePath: config.databasePath,
      force: options.force,
    });
  });

program
  .command("process-staging")
  .description(
    "Analyze, name, and import staged tracks into the library database",
  )
  .option(
    "--staging-dir <path>",
    "Staging directory with MP3s",
    "./data/staging/songs",
  )
  .option("--skip-analyze", "Skip audio analysis if analysis.json exists")
  .option("--skip-naming", "Skip LLM track naming")
  .option("--force-names", "Regenerate track names")
  .option(
    "--replace-temporary",
    "Remove temporary Internet Archive tracks before import",
  )
  .option("--dry-run", "Preview import without writing")
  .action(async (options: {
    stagingDir: string;
    skipAnalyze?: boolean;
    skipNaming?: boolean;
    forceNames?: boolean;
    replaceTemporary?: boolean;
    dryRun?: boolean;
  }) => {
    const config = loadConfig();
    await processStaging(repoRoot, config, {
      stagingDir: options.stagingDir,
      skipAnalyze: options.skipAnalyze,
      skipNaming: options.skipNaming,
      forceNames: options.forceNames,
      replaceTemporary: options.replaceTemporary,
      dryRun: options.dryRun,
    });
  });

program
  .command("record-videos")
  .description(
    "Record 1920×1080 visualizer videos for tracks missing YouTube URLs (requires dashboard running)",
  )
  .option("--limit <n>", "Max tracks to record")
  .option("--track-id <id>", "Record a single track by id")
  .option("--force", "Re-record even if MP4 already exists")
  .action(async (options: {
    limit?: string;
    trackId?: string;
    force?: boolean;
  }) => {
    const config = loadConfig();
    await recordTrackVideos(config, {
      limit: options.limit ? Number(options.limit) : undefined,
      trackId: options.trackId,
      force: options.force,
    });
  });

program
  .command("upload-youtube")
  .description("Upload recorded MP4s to YouTube and save youtube_url in the database")
  .option("--limit <n>", "Max tracks to upload")
  .option("--track-id <id>", "Upload a single track by id")
  .option("--force", "Re-upload even if youtube_url is already set")
  .action(async (options: {
    limit?: string;
    trackId?: string;
    force?: boolean;
  }) => {
    const config = loadConfig();
    await uploadTrackVideos(config, {
      limit: options.limit ? Number(options.limit) : undefined,
      trackId: options.trackId,
      force: options.force,
    });
  });

program
  .command("publish-youtube")
  .description("Record visualizer videos and upload them to YouTube")
  .option("--limit <n>", "Max tracks to publish")
  .option("--track-id <id>", "Publish a single track by id")
  .option("--skip-record", "Upload existing MP4s only")
  .option("--skip-upload", "Record MP4s only")
  .option("--force", "Re-record/re-upload even if outputs exist")
  .action(async (options: {
    limit?: string;
    trackId?: string;
    skipRecord?: boolean;
    skipUpload?: boolean;
    force?: boolean;
  }) => {
    const config = loadConfig();
    await publishTracksToYouTube(config, {
      limit: options.limit ? Number(options.limit) : undefined,
      trackId: options.trackId,
      skipRecord: options.skipRecord,
      skipUpload: options.skipUpload,
      force: options.force,
    });
  });

program
  .command("youtube-auth")
  .description("One-time OAuth flow to obtain YOUTUBE_REFRESH_TOKEN for uploads")
  .action(async () => {
    const config = loadConfig();
    if (!config.youtubeClientId || !config.youtubeClientSecret) {
      throw new Error(
        "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first (Google Cloud OAuth desktop app)",
      );
    }

    const refreshToken = await runYouTubeOAuthFlow(
      config.youtubeClientId,
      config.youtubeClientSecret,
      config.youtubeOAuthRedirectUri,
    );

    console.log("\nAdd this to your .env:\n");
    console.log(`YOUTUBE_REFRESH_TOKEN=${refreshToken}\n`);
  });

program
  .command("youtube-live-auth")
  .description(
    "One-time OAuth flow with live streaming scopes (includes upload + manage broadcasts)",
  )
  .action(async () => {
    const config = loadConfig();
    if (!config.youtubeClientId || !config.youtubeClientSecret) {
      throw new Error(
        "Set YOUTUBE_CLIENT_ID and YOUTUBE_CLIENT_SECRET in .env first",
      );
    }

    const refreshToken = await runYouTubeOAuthFlow(
      config.youtubeClientId,
      config.youtubeClientSecret,
      config.youtubeOAuthRedirectUri,
      YOUTUBE_LIVE_SCOPES,
    );

    console.log("\nAdd this to your .env:\n");
    console.log(`YOUTUBE_REFRESH_TOKEN=${refreshToken}\n`);
  });

const DEFAULT_LIVE_TITLE =
  "🔴 24/7 Lofi & Chill Radio Live | Beats to Study, Relax & Sleep";
const DEFAULT_LIVE_DESCRIPTION =
  "Non-stop live music 24/7 — lofi, jazz, ambient, rock & synthwave. Perfect for studying, working, relaxing, or sleeping. Chat with DJ Monkey and request your vibe! 🎧";

program
  .command("youtube-live-create")
  .description("Create a YouTube live broadcast + RTMP ingest stream")
  .option("--title <title>", "Broadcast title", DEFAULT_LIVE_TITLE)
  .option(
    "--description <text>",
    "Broadcast description",
    DEFAULT_LIVE_DESCRIPTION,
  )
  .action(async (options: { title: string; description: string }) => {
    const config = loadConfig();
    const auth = requireYouTubeAuth(config);

    const info = await createLiveBroadcast(auth, options.title, options.description);

    console.log("\nYouTube live broadcast created:\n");
    console.log(`  Broadcast ID: ${info.broadcastId}`);
    console.log(`  Stream ID:    ${info.streamId}`);
    console.log(`  Status:       ${info.lifeCycleStatus}`);
    console.log(`\nAdd these to your .env:\n`);
    console.log(`YOUTUBE_BROADCAST_ID=${info.broadcastId}`);
    console.log(`YOUTUBE_VIDEO_ID=${info.broadcastId}`);
    console.log(`YOUTUBE_RTMP_URL=${info.rtmpUrl}`);
    console.log(`YOUTUBE_STREAM_KEY=${info.streamKey}`);
    console.log(`CHAT_PROVIDER=youtube`);
    console.log(`\nThen start streaming and run: npm run youtube:live-go`);
  });

program
  .command("youtube-live-update")
  .description("Update title and description of the configured live broadcast")
  .option("--title <title>", "Broadcast title", DEFAULT_LIVE_TITLE)
  .option(
    "--description <text>",
    "Broadcast description",
    DEFAULT_LIVE_DESCRIPTION,
  )
  .option(
    "--broadcast-id <id>",
    "Broadcast ID (defaults to YOUTUBE_BROADCAST_ID env)",
  )
  .action(async (options: {
    title: string;
    description: string;
    broadcastId?: string;
  }) => {
    const config = loadConfig();
    const auth = requireYouTubeAuth(config);
    const broadcastId =
      options.broadcastId ?? process.env.YOUTUBE_BROADCAST_ID;

    if (!broadcastId) {
      throw new Error(
        "Set YOUTUBE_BROADCAST_ID in .env or pass --broadcast-id",
      );
    }

    const updated = await updateLiveBroadcast(auth, broadcastId, {
      title: options.title,
      description: options.description,
    });

    console.log("\nYouTube live broadcast updated:\n");
    console.log(`  Broadcast ID: ${broadcastId}`);
    console.log(`  Title:        ${updated.title}`);
    console.log(`  Description:  ${updated.description.slice(0, 120)}…`);
  });

program
  .command("youtube-live-go")
  .description("Transition the configured broadcast to LIVE (after RTMP is flowing)")
  .action(async () => {
    const config = loadConfig();
    const auth = requireYouTubeAuth(config);
    const broadcastId = process.env.YOUTUBE_BROADCAST_ID;

    if (!broadcastId) {
      throw new Error("Set YOUTUBE_BROADCAST_ID in .env (run youtube-live-create first)");
    }

    const result = await transitionBroadcastToLive(auth, broadcastId);
    console.log(`Broadcast is now: ${result.lifeCycleStatus}`);
    console.log(`Set YOUTUBE_VIDEO_ID=${broadcastId} for live chat polling.`);
  });

program
  .command("youtube-live-status")
  .description("Show status of the configured or active live broadcasts")
  .action(async () => {
    const config = loadConfig();
    const auth = requireYouTubeAuth(config);
    const broadcastId = process.env.YOUTUBE_BROADCAST_ID;

    if (broadcastId) {
      const status = await getLiveBroadcastStatus(auth, broadcastId);
      if (!status) {
        console.log(`No broadcast found for ID: ${broadcastId}`);
        return;
      }
      console.log(JSON.stringify(status, null, 2));
      return;
    }

    const active = await listActiveBroadcasts(auth);
    if (active.length === 0) {
      console.log("No active broadcasts. Run: npm run youtube:live-create");
      return;
    }

    console.log("Active broadcasts:");
    for (const item of active) {
      console.log(`  ${item.id} — ${item.title} (${item.lifeCycleStatus})`);
    }
  });

program
  .command("suno-login")
  .description("Log into Suno in a browser and save session for generation")
  .action(async () => {
    const config = loadConfig();
    const paths = resolveSunoLoginPaths(repoRoot, config);
    await runSunoLogin(paths);
  });

program
  .command("seed")
  .description(
    "Download temporary royalty-free tracks from Internet Archive (dev/testing)",
  )
  .option(
    "--tracks-per-genre <n>",
    "Target ready tracks per genre",
    "10",
  )
  .option("--genre <id>", "Seed a single genre only")
  .option("--force", "Download even if genre already meets target count")
  .action(async (options: {
    tracksPerGenre: string;
    genre?: string;
    force?: boolean;
  }) => {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);
    const genres = resolveSeedGenres(options.genre);

    await seedLibraryFromArchive(db, config, {
      tracksPerGenre: Number(options.tracksPerGenre),
      genres,
      skipExisting: !options.force,
    });

    db.close();
  });

program
  .command("import-analysis")
  .description(
    "Import analyzed YouTube tracks from analysis.json into the library",
  )
  .option(
    "--analysis <path>",
    "Path to analysis.json",
    "./data/temp/youtube-import/analysis.json",
  )
  .option(
    "--replace-temporary",
    "Remove temporary Internet Archive tracks first",
  )
  .option("--dry-run", "Preview import without writing")
  .action(async (options: {
    analysis: string;
    replaceTemporary?: boolean;
    dryRun?: boolean;
  }) => {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);
    const analysisPath = resolve(repoRoot, options.analysis);

    const result = importFromAnalysis(db, config, {
      analysisPath,
      replaceTemporary: options.replaceTemporary,
      dryRun: options.dryRun,
    });

    console.log(
      `\nDone: ${result.imported} imported, ${result.removed} removed, ${result.skipped} skipped.`,
    );
    db.close();
  });

program
  .command("import-youtube")
  .description(
    "One-time import: download MP3s from your YouTube channel into the library",
  )
  .requiredOption("--channel <url>", "YouTube channel URL or @handle")
  .requiredOption(
    "--genre <id>",
    "Genre to file tracks under (jazz, synthwave, lofi, ambient, funk, rock)",
  )
  .option("--limit <n>", "Max number of videos to import")
  .option("--dry-run", "List videos without downloading")
  .action(async (options: {
    channel: string;
    genre: string;
    limit?: string;
    dryRun?: boolean;
  }) => {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);
    const genre = resolveImportGenre(options.genre);

    const result = await importYouTubeChannel(db, config, {
      channelUrl: options.channel,
      genre,
      limit: options.limit ? Number(options.limit) : undefined,
      dryRun: options.dryRun,
    });

    console.log(
      `\nDone: ${result.downloaded} downloaded, ${result.skipped} skipped.`,
    );
    db.close();
  });

program
  .command("fill", { isDefault: true })
  .description("Enqueue and process track generation jobs")
  .option(
    "--tracks-per-genre <n>",
    "Target ready tracks per genre",
    "20",
  )
  .option("--genre <id>", "Generate for a single genre only")
  .option("--force", "Enqueue even if genre already meets target count")
  .action(async (options: {
    tracksPerGenre: string;
    genre?: string;
    force?: boolean;
  }) => {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);
    const provider = await createSunoProvider(config);
    const genres = resolveGenres(options.genre);

    await fillLibrary(db, provider, config, {
      tracksPerGenre: Number(options.tracksPerGenre),
      genres,
      skipExisting: !options.force,
    });

    db.close();
  });

program
  .command("watch")
  .description("Continuously fill library deficits until targets are met")
  .option(
    "--tracks-per-genre <n>",
    "Target ready tracks per genre",
    "20",
  )
  .option("--genre <id>", "Watch a single genre only")
  .option(
    "--interval-min <n>",
    "Minutes between fill cycles when nothing to do",
    "30",
  )
  .action(async (options: {
    tracksPerGenre: string;
    genre?: string;
    intervalMin: string;
  }) => {
    const config = loadConfig();
    const target = Number(options.tracksPerGenre);
    const intervalMs = Number(options.intervalMin) * 60_000;
    const genres = resolveGenres(options.genre);

    console.log(
      `Library watch started — target ${target}/genre, checking every ${options.intervalMin} min`,
    );

    while (true) {
      const db = openDatabase(config.databasePath);
      const health = checkLibraryHealth(db, target, { requireAllGenres: true });
      const relevantDeficits = Object.fromEntries(
        Object.entries(health.deficits).filter(([genre]) =>
          genres.includes(genre as (typeof genres)[number]),
        ),
      );

      if (Object.keys(relevantDeficits).length === 0) {
        console.log("All genres meet target — sleeping...");
        db.close();
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      console.log("Deficits:", relevantDeficits);

      try {
        const provider = await createSunoProvider(config);
        await fillLibrary(db, provider, config, {
          tracksPerGenre: target,
          genres,
          skipExisting: true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`Fill cycle failed: ${message}`);
        console.log(`Retrying in ${options.intervalMin} min...`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }

      db.close();
    }
  });

program
  .command("status")
  .description("Show track counts per genre and status")
  .option("--json", "Output as JSON")
  .action((options: { json?: boolean }) => {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);

    const byStatus = getTrackCountsByGenreAndStatus(db);
    const ready = getReadyTrackCountByGenre(db);

    if (options.json) {
      console.log(JSON.stringify({ ready, byStatus }, null, 2));
    } else {
      console.log("Ready tracks by genre:");
      for (const [genre, count] of Object.entries(ready)) {
        console.log(`  ${genre}: ${count}`);
      }

      console.log("\nAll statuses:");
      for (const [genre, statuses] of Object.entries(byStatus)) {
        const parts = Object.entries(statuses)
          .map(([status, count]) => `${status}=${count}`)
          .join(", ");
        console.log(`  ${genre}: ${parts}`);
      }
    }

    db.close();
  });

program
  .command("retry-failed")
  .description("Re-queue failed generation jobs under max retry limit")
  .action(async () => {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);
    const provider = await createSunoProvider(config);

    const failed = getFailedJobs(db).filter(
      (job) => job.attempts < config.maxRetries,
    );

    if (failed.length === 0) {
      console.log("No failed jobs eligible for retry.");
      db.close();
      return;
    }

    for (const job of failed) {
      requeueFailedJob(db, job.id);
      console.log(`Re-queued job ${job.id} (${job.genre})`);
    }

    await processQueue(db, provider, config);
    db.close();
  });

program
  .command("health")
  .description("Check minimum library health (10 ready tracks per genre)")
  .option("--min <n>", "Minimum ready tracks per genre", "10")
  .option(
    "--relaxed",
    "Ignore genres with zero tracks (matches broadcast startup gate)",
  )
  .action((options: { min: string; relaxed?: boolean }) => {
    const config = loadConfig();
    const db = openDatabase(config.databasePath);

    const result = checkLibraryHealth(db, Number(options.min), {
      requireAllGenres: !options.relaxed,
    });

    if (result.ok) {
      console.log("Library health OK — all genres meet minimum.");
    } else {
      console.error("Library health FAILED — deficits:");
      for (const [genre, deficit] of Object.entries(result.deficits)) {
        const ready = result.readyCounts[genre] ?? 0;
        console.error(`  ${genre}: ${ready} ready, need ${deficit} more`);
      }
      db.close();
      process.exit(1);
    }

    db.close();
  });

program
  .command("remove-track")
  .description("Remove a track from the library database, disk, and CDN")
  .option("--id <trackId>", "Track UUID")
  .option("--title <query>", "Match track title (partial, case-sensitive SQL LIKE)")
  .option("--dry-run", "Show matches without deleting")
  .option("--skip-cdn", "Do not delete the MP3 from R2/CDN")
  .action(async (options: {
    id?: string;
    title?: string;
    dryRun?: boolean;
    skipCdn?: boolean;
  }) => {
    const config = loadConfig();
    await removeTrack(config, {
      trackId: options.id,
      title: options.title,
      dryRun: options.dryRun,
      skipCdn: options.skipCdn,
    });
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
