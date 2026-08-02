import { randomUUID } from "node:crypto";
import type { BroadcastWorkerConfig, MonkeyRadioDb, Track } from "@monkey-radio/shared";
import {
  checkLibraryReady,
  getBroadcastState,
  insertPlaybackLog,
  trackDurationMs,
  updateBroadcastState,
} from "@monkey-radio/shared";
import type { ChatBuffer } from "./chat/buffer.js";
import { generateDjSegment, type DjPipelineResult } from "./dj/pipeline.js";
import { selectNextTrack, trackStyle } from "./playlist/selector.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function djDurationMs(durationSec: number): number {
  return Math.ceil(durationSec * 1000);
}

function trackStartMs(db: MonkeyRadioDb, fallbackStartedAt: string): number {
  const state = getBroadcastState(db);
  return Date.parse(state?.track_started_at ?? fallbackStartedAt);
}

function consumeSkipTrack(db: MonkeyRadioDb): boolean {
  const state = getBroadcastState(db);
  if (!state?.skip_track) return false;

  updateBroadcastState(db, { skip_track: 0 });
  console.log("[broadcast] skip to transition requested");
  return true;
}

async function pollInterval(ms: number): Promise<void> {
  await sleep(ms);
}

async function waitForDjResult(
  djPromise: Promise<DjPipelineResult | null>,
  db: MonkeyRadioDb,
): Promise<DjPipelineResult | null> {
  while (true) {
    consumeSkipTrack(db);

    const resolved = await Promise.race([
      djPromise.then((value) => ({ done: true as const, value })),
      pollInterval(250).then(() => ({ done: false as const })),
    ]);

    if (resolved.done) {
      return resolved.value;
    }
  }
}

function shouldPlayDj(
  config: BroadcastWorkerConfig,
  tracksSinceDj: number,
  lastDjAt: string | null,
): boolean {
  if (tracksSinceDj < config.minTracksBeforeDj) return false;
  if (!lastDjAt) return true;

  const elapsedSec = (Date.now() - new Date(lastDjAt).getTime()) / 1000;
  return elapsedSec >= config.djMinIntervalSec;
}

function pendingDjMood(
  track: Track,
  djResult: DjPipelineResult,
  trackStartedAt: string,
  durationMs: number,
  fadeMs: number,
): string {
  const transitionAtMs = Math.max(0, durationMs - fadeMs);
  const startsAt = new Date(
    Date.parse(trackStartedAt) + transitionAtMs,
  ).toISOString();

  return JSON.stringify({
    phase: "track",
    status: "playing",
    title: track.title,
    pendingDj: {
      segmentId: djResult.segmentId,
      durationSec: djResult.durationSec,
      startsAt,
      scriptPreview: djResult.scriptText.slice(0, 160),
    },
    nextTrack: {
      id: djResult.nextTrack.id,
      title: djResult.nextTrack.title,
      genre: djResult.nextTrack.genre,
    },
  });
}

function beginDjPhase(
  db: MonkeyRadioDb,
  chatBuffer: ChatBuffer,
  djResult: DjPipelineResult,
): string {
  const startedAt = new Date().toISOString();

  updateBroadcastState(db, {
    current_phase: "dj",
    current_track_id: null,
    current_dj_segment_id: djResult.segmentId,
    dj_started_at: startedAt,
    current_genre: trackStyle(djResult.nextTrack),
    last_dj_at: startedAt,
    messages_snapshot: chatBuffer.snapshot(),
    skip_track: 0,
    current_mood: JSON.stringify({
      phase: "dj",
      mood: djResult.mood.mood,
      energy: djResult.mood.energy,
      nextStyle: trackStyle(djResult.nextTrack),
      scriptPreview: djResult.scriptText.slice(0, 160),
      nextTrack: {
        id: djResult.nextTrack.id,
        title: djResult.nextTrack.title,
        genre: djResult.nextTrack.genre,
      },
    }),
  });

  console.log(
    `[dj on air] ${Math.round(djResult.durationSec)}s — "${djResult.scriptText.slice(0, 80)}…"`,
  );

  return startedAt;
}

async function playTrack(
  db: MonkeyRadioDb,
  chatBuffer: ChatBuffer,
  config: BroadcastWorkerConfig,
  track: Track,
  tracksSinceDj: number,
  lastDjAt: string | null,
): Promise<{
  djResult: DjPipelineResult | null;
  tracksSinceDj: number;
}> {
  const startedAt = new Date().toISOString();
  const durationMs = trackDurationMs(track.duration_sec);
  const prepLeadMs = config.djPrepLeadSec * 1000;
  const fadeMs = config.crossfadeSec * 1000;
  const scheduleDj = shouldPlayDj(config, tracksSinceDj, lastDjAt);
  const prepStartMs = Math.max(0, durationMs - prepLeadMs);
  const transitionAtMs = Math.max(0, durationMs - fadeMs);

  updateBroadcastState(db, {
    current_phase: "track",
    current_genre: track.genre,
    current_track_id: track.id,
    track_started_at: startedAt,
    current_dj_segment_id: null,
    dj_started_at: null,
    skip_track: 0,
    messages_snapshot: chatBuffer.snapshot(),
    current_mood: JSON.stringify({
      phase: "track",
      status: "playing",
      title: track.title,
    }),
  });

  insertPlaybackLog(db, {
    id: randomUUID(),
    trackId: track.id,
    genre: track.genre,
  });

  console.log(
    `[now playing] ${track.genre} — ${track.title ?? track.id} (${track.duration_sec ?? "?"}s)`,
  );

  if (!scheduleDj) {
    while (Date.now() - trackStartMs(db, startedAt) < durationMs) {
      consumeSkipTrack(db);
      await pollInterval(250);
    }
    return {
      djResult: null,
      tracksSinceDj: tracksSinceDj + 1,
    };
  }

  let djPromise: Promise<DjPipelineResult | null> | null = null;
  let djResult: DjPipelineResult | null = null;

  while (true) {
    consumeSkipTrack(db);
    const elapsed = Date.now() - trackStartMs(db, startedAt);

    if (!djPromise && elapsed >= prepStartMs) {
      console.log("[broadcast] preparing DJ segment");
      djPromise = generateDjSegment(db, config, chatBuffer, {
        lastTrack: track,
      });
    }

    if (djPromise && !djResult) {
      const pending = await Promise.race([
        djPromise.then((value) => ({ done: true as const, value })),
        pollInterval(250).then(() => ({ done: false as const })),
      ]);
      if (pending.done) {
        djResult = pending.value;
      }
    }

    if (djResult && elapsed >= transitionAtMs) {
      break;
    }

    if (!djResult && elapsed >= durationMs) {
      return {
        djResult: null,
        tracksSinceDj: tracksSinceDj + 1,
      };
    }

    await pollInterval(250);
  }

  if (!djResult) {
    djResult = djPromise ? await waitForDjResult(djPromise, db) : null;
  }

  if (!djResult) {
    while (Date.now() - trackStartMs(db, startedAt) < durationMs) {
      consumeSkipTrack(db);
      await pollInterval(250);
    }
    return {
      djResult: null,
      tracksSinceDj: tracksSinceDj + 1,
    };
  }

  const trackStartedAt =
    getBroadcastState(db)?.track_started_at ?? startedAt;

  updateBroadcastState(db, {
    current_mood: pendingDjMood(
      track,
      djResult,
      trackStartedAt,
      durationMs,
      fadeMs,
    ),
  });

  beginDjPhase(db, chatBuffer, djResult);
  await sleep(djDurationMs(djResult.durationSec));

  return {
    djResult,
    tracksSinceDj: 0,
  };
}

export async function runBroadcastLoop(
  db: MonkeyRadioDb,
  config: BroadcastWorkerConfig,
  chatBuffer: ChatBuffer,
): Promise<void> {
  const health = checkLibraryReady(db, config.minLibraryPerGenre);
  if (!health.ok) {
    throw new Error(
      `Library not ready for broadcast: need ${config.minLibraryPerGenre} tracks, have ${health.totalReady ?? 0}`,
    );
  }

  let lastTrackId: string | undefined;
  let tracksSinceDj = config.minTracksBeforeDj;
  let lastDjAt: string | null = null;
  let pendingNextTrack: Track | undefined;

  console.log("Monkey Radio broadcast started");
  console.log(
    `[dj] llm=${config.llmProvider} tts=${config.ttsProvider} chat=${config.chatProvider} fade=${config.crossfadeSec}s`,
  );

  while (true) {
    try {
      const track =
        pendingNextTrack ??
        selectNextTrack(db, config, { excludeTrackId: lastTrackId });
      pendingNextTrack = undefined;

      const trackResult = await playTrack(
        db,
        chatBuffer,
        config,
        track,
        tracksSinceDj,
        lastDjAt,
      );
      lastTrackId = track.id;

      if (trackResult.djResult) {
        pendingNextTrack = trackResult.djResult.nextTrack;
        tracksSinceDj = 0;
        lastDjAt = new Date().toISOString();
      } else {
        tracksSinceDj = trackResult.tracksSinceDj;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[broadcast] loop error: ${message}`);
      pendingNextTrack = undefined;
      await sleep(5000);
    }
  }
}
