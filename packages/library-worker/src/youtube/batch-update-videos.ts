import type { LibraryWorkerConfig, Track } from "@monkey-radio/shared";
import {
  getTracksWithYouTubeUrl,
  openDatabase,
  parseYouTubeVideoId,
} from "@monkey-radio/shared";
import { requireYouTubeAuth } from "./auth.js";
import {
  fetchYouTubeVideos,
  mergeRoyaltyFreeDescription,
  updateYouTubeVideoMetadata,
} from "./video-metadata.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function batchUpdateYouTubeVideos(
  config: LibraryWorkerConfig,
  options: {
    dryRun?: boolean;
    limit?: number;
    delayMs?: number;
    liveStreamUrl?: string;
  } = {},
): Promise<{
  total: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const auth = requireYouTubeAuth(config);
  const db = openDatabase(config.databasePath);

  try {
    let tracks = getTracksWithYouTubeUrl(db);
    if (options.limit && options.limit > 0) {
      tracks = tracks.slice(0, options.limit);
    }

    const trackByVideoId = new Map<string, Track>();
    for (const track of tracks) {
      if (!track.youtube_url) continue;
      const videoId = parseYouTubeVideoId(track.youtube_url);
      if (videoId) trackByVideoId.set(videoId, track);
    }

    const videoIds = [...trackByVideoId.keys()];
    console.log(`Found ${videoIds.length} published track video(s) in the library.`);

    if (options.dryRun) {
      let updated = 0;
      for (const [, track] of trackByVideoId) {
        const title = track.display_name ?? track.title ?? track.id;
        const nextDescription = mergeRoyaltyFreeDescription("", track, {
          liveStreamUrl: options.liveStreamUrl,
        });
        updated += 1;
        console.log(`  [dry-run] would update: ${title}`);
        console.log("            license → creativeCommon");
        console.log(`            description → ${nextDescription.slice(0, 80)}…`);
      }

      return {
        total: videoIds.length,
        updated,
        skipped: 0,
        failed: 0,
      };
    }

    const videos = await fetchYouTubeVideos(auth, videoIds);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const [videoId, track] of trackByVideoId) {
      const video = videos.get(videoId);
      if (!video) {
        failed += 1;
        console.warn(`  ✗ missing on YouTube: ${track.display_name ?? track.title} (${videoId})`);
        continue;
      }

      const title = track.display_name ?? track.title ?? videoId;
      const nextDescription = mergeRoyaltyFreeDescription(
        video.snippet.description ?? "",
        track,
        { liveStreamUrl: options.liveStreamUrl },
      );
      const needsLicense = video.status.license !== "creativeCommon";
      const needsDescription = nextDescription !== (video.snippet.description ?? "");

      if (!needsLicense && !needsDescription) {
        skipped += 1;
        console.log(`  · skip (already up to date): ${title}`);
        continue;
      }

      try {
        await updateYouTubeVideoMetadata(auth, video, {
          description: nextDescription,
          license: "creativeCommon",
        });
        updated += 1;
        console.log(`  ✓ updated: ${title}`);
        if (options.delayMs && options.delayMs > 0) {
          await sleep(options.delayMs);
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`  ✗ failed: ${title} — ${message}`);
      }
    }

    return {
      total: videoIds.length,
      updated,
      skipped,
      failed,
    };
  } finally {
    db.close();
  }
}
