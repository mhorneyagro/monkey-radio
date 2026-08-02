import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  getReadyTracksWithoutYoutube,
  openDatabase,
  updateTrack,
  type LibraryWorkerConfig,
} from "@monkey-radio/shared";
import { recordTrackVideo } from "./record-video.js";
import { uploadVideoToYouTube } from "../youtube/upload.js";
import { requireYouTubeAuth } from "../youtube/auth.js";

export interface PublishOptions {
  limit?: number;
  trackId?: string;
  skipRecord?: boolean;
  skipUpload?: boolean;
  force?: boolean;
}

export async function publishTracksToYouTube(
  config: LibraryWorkerConfig,
  options: PublishOptions = {},
): Promise<void> {
  const db = openDatabase(config.databasePath);
  try {
    const tracks = getReadyTracksWithoutYoutube(db, {
      limit: options.limit ?? 10_000,
      trackId: options.trackId,
    });

    if (tracks.length === 0) {
      console.log("No tracks pending YouTube publish.");
      return;
    }

    console.log(`Publishing ${tracks.length} track(s) to YouTube…`);

    const auth = options.skipUpload
      ? null
      : requireYouTubeAuth(config);

    for (const track of tracks) {
      const label = track.display_name ?? track.title ?? track.id;
      console.log(`\n→ ${label}`);

      try {
        let videoPath = join(config.videoOutputPath, `${track.id}.mp4`);

        if (!options.skipRecord) {
          videoPath = await recordTrackVideo(config, {
            track,
            libraryPath: config.libraryPath,
            force: options.force,
          });
        } else if (!existsSync(videoPath)) {
          console.error(`  skip upload — no video at ${videoPath}`);
          continue;
        }

        if (options.skipUpload) {
          continue;
        }

        if (track.youtube_url && !options.force) {
          console.log(`  skip upload (already published): ${track.youtube_url}`);
          continue;
        }

        const youtubeUrl = await uploadVideoToYouTube({
          auth: auth!,
          videoPath,
          track,
          privacyStatus: config.youtubeVideoPrivacy,
        });

        updateTrack(db, track.id, { youtube_url: youtubeUrl });
        console.log(`  uploaded → ${youtubeUrl}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`  failed: ${message}`);
      }
    }
  } finally {
    db.close();
  }
}

export async function recordTrackVideos(
  config: LibraryWorkerConfig,
  options: Pick<PublishOptions, "limit" | "trackId" | "force"> = {},
): Promise<void> {
  await publishTracksToYouTube(config, {
    ...options,
    skipUpload: true,
  });
}

export async function uploadTrackVideos(
  config: LibraryWorkerConfig,
  options: Pick<PublishOptions, "limit" | "trackId" | "force"> = {},
): Promise<void> {
  await publishTracksToYouTube(config, {
    ...options,
    skipRecord: true,
  });
}
