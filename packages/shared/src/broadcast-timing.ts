export const SKIP_TO_TRANSITION_LEAD_MS = 10_000;

export function trackDurationMs(durationSec: number | null): number {
  if (durationSec && durationSec > 0) {
    return Math.ceil(durationSec * 1000);
  }
  return 180_000;
}

export function skipTransitionLeadMs(durationMs: number): number {
  return Math.min(
    SKIP_TO_TRANSITION_LEAD_MS,
    Math.max(1000, durationMs - 1000),
  );
}

export function skipTargetOffsetMs(
  durationMs: number,
  elapsedMs: number,
  prepLeadMs: number,
  hasPendingDj: boolean,
): number {
  const prepStartMs = Math.max(0, durationMs - prepLeadMs);
  const nearEndMs = durationMs - skipTransitionLeadMs(durationMs);

  if (!hasPendingDj && elapsedMs < prepStartMs) {
    return prepStartMs;
  }

  return nearEndMs;
}

export function trackStartIsoForOffset(offsetMs: number): string {
  return new Date(Date.now() - offsetMs).toISOString();
}

export function backdatedTrackStartIso(
  durationMs: number,
  leadMs = skipTransitionLeadMs(durationMs),
): string {
  return trackStartIsoForOffset(durationMs - leadMs);
}

export function moodHasPendingDj(moodRaw: string | null | undefined): boolean {
  if (!moodRaw) return false;
  try {
    const mood = JSON.parse(moodRaw) as {
      pendingDj?: { segmentId?: string };
    };
    return typeof mood.pendingDj?.segmentId === "string";
  } catch {
    return false;
  }
}
