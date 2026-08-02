import type { SunoClip } from "./session.js";

export function clipHasAudio(clip: SunoClip): boolean {
  return Boolean(clip.audio_url);
}

export function clipIsFailed(clip: SunoClip): boolean {
  return clip.status === "error" || clip.status === "failed";
}

export function clipDurationSec(clip: SunoClip): number {
  const raw = clip.metadata?.duration ?? clip.duration;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string") return Number.parseFloat(raw) || 0;
  return 0;
}

export function toSunoTrack(clip: SunoClip) {
  return {
    id: clip.id,
    audioUrl: clip.audio_url!,
    title: clip.title ?? "Untitled",
    duration: clipDurationSec(clip),
  };
}
