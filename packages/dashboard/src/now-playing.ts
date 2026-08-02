import type { MonkeyRadioDb, Track } from "@monkey-radio/shared";
import {
  getBroadcastPlayback,
  getTrackById,
  resolveDjAudioUrl,
  resolveTrackAudioUrl,
} from "@monkey-radio/shared";

function parseMood(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function estimateDjDuration(script: string): number {
  const words = script.split(/\s+/).filter(Boolean).length;
  return Math.min(45, Math.max(8, words * 0.45));
}

function djDurationSec(segment: {
  duration_sec: number | null;
  script_text: string;
}): number {
  if (segment.duration_sec && segment.duration_sec > 0) {
    return segment.duration_sec;
  }
  return estimateDjDuration(segment.script_text);
}

function buildUpcomingTrack(
  trackId: string,
  track: Track | undefined,
  libraryCdnUrl?: string,
) {
  if (!track) return null;
  return {
    id: track.id,
    title: track.title,
    genre: track.genre,
    durationSec: track.duration_sec,
    audioUrl: resolveTrackAudioUrl(trackId, track.file_path, libraryCdnUrl),
  };
}

export function buildNowPlayingResponse(
  db: MonkeyRadioDb,
  broadcastConfig: { crossfadeSec: number },
  options: { libraryCdnUrl?: string } = {},
) {
  const { libraryCdnUrl } = options;
  const playback = getBroadcastPlayback(db);

  if (!playback) {
    return { playing: false as const };
  }

  const { state, track, djSegment } = playback;
  const phase = state.current_phase ?? (track ? "track" : "dj");
  const mood = parseMood(state.current_mood);
  const fadeOutSec = broadcastConfig.crossfadeSec;
  const timing = { fadeOutSec };

  if (phase === "dj" && djSegment) {
    const durationSec = djDurationSec(djSegment);
    const outgoingTrack = djSegment.track_before
      ? getTrackById(db, djSegment.track_before)
      : undefined;
    const upcomingTrack = buildUpcomingTrack(
      djSegment.track_after ?? "",
      djSegment.track_after
        ? getTrackById(db, djSegment.track_after)
        : undefined,
      libraryCdnUrl,
    );

    let outgoing: Record<string, unknown> | null = null;
    if (outgoingTrack && state.dj_started_at && fadeOutSec > 0) {
      const fadeStartedAt = state.dj_started_at;
      const fadeEndMs = Date.parse(fadeStartedAt) + fadeOutSec * 1000;
      if (Date.now() < fadeEndMs + 500) {
        const trackStartedAt = outgoingTrack.created_at;
        outgoing = {
          id: outgoingTrack.id,
          title: outgoingTrack.title,
          genre: outgoingTrack.genre,
          durationSec: outgoingTrack.duration_sec,
          startedAt: state.track_started_at ?? trackStartedAt,
          audioUrl: resolveTrackAudioUrl(
            outgoingTrack.id,
            outgoingTrack.file_path,
            libraryCdnUrl,
          ),
          fadeOutSec,
          fadeStartedAt,
        };
      }
    }

    return {
      playing: true as const,
      phase: "dj" as const,
      timing,
      djSegment: {
        id: djSegment.id,
        scriptText: djSegment.script_text,
        startedAt: state.dj_started_at,
        durationSec,
      },
      track: null,
      outgoingTrack: outgoing,
      upcomingTrack,
      mood,
      audioUrl: resolveDjAudioUrl(djSegment.id),
    };
  }

  if (!track) {
    return { playing: false as const };
  }

  const pendingDj =
    mood && typeof mood.pendingDj === "object" && mood.pendingDj
      ? (mood.pendingDj as Record<string, unknown>)
      : null;
  const nextTrackMood =
    mood && typeof mood.nextTrack === "object" && mood.nextTrack
      ? (mood.nextTrack as Record<string, unknown>)
      : null;

  let upcomingDj: Record<string, unknown> | null = null;
  if (pendingDj && typeof pendingDj.segmentId === "string") {
    upcomingDj = {
      id: pendingDj.segmentId,
      startsAt: pendingDj.startsAt,
      durationSec: pendingDj.durationSec,
      scriptText: pendingDj.scriptPreview,
      audioUrl: resolveDjAudioUrl(pendingDj.segmentId),
    };
  }

  let upcomingTrack: ReturnType<typeof buildUpcomingTrack> = null;
  if (nextTrackMood && typeof nextTrackMood.id === "string") {
    upcomingTrack = buildUpcomingTrack(
      nextTrackMood.id,
      getTrackById(db, nextTrackMood.id),
      libraryCdnUrl,
    );
  }

  return {
    playing: true as const,
    phase: "track" as const,
    timing,
    track: {
      id: track.id,
      title: track.title,
      genre: track.genre,
      durationSec: track.duration_sec,
      startedAt: state.track_started_at,
    },
    djSegment: null,
    upcomingDj,
    upcomingTrack,
    mood,
    audioUrl: resolveTrackAudioUrl(track.id, track.file_path, libraryCdnUrl),
  };
}
