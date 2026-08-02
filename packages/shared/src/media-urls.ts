/**
 * Resolve public audio URLs for tracks and DJ segments.
 * When LIBRARY_CDN_URL is set, track MP3s are served from CDN (object storage).
 * DJ segments always use the local API — they are generated on the broadcast server.
 */

export function normalizeCdnBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function cdnObjectUrl(
  cdnBaseUrl: string,
  filePath: string,
): string {
  const base = normalizeCdnBaseUrl(cdnBaseUrl);
  const path = storageObjectKey(filePath);
  return `${base}/${path}`;
}

/** Map SQLite file_path to R2 object key (strips optional library/ prefix). */
export function storageObjectKey(filePath: string): string {
  const normalized = filePath.replace(/^\/+/, "");
  if (normalized.startsWith("library/")) {
    return normalized.slice("library/".length);
  }
  return normalized;
}

export function isAbsoluteMediaUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Track audio — CDN when configured and file_path is a storage key, else local API. */
export function resolveTrackAudioUrl(
  trackId: string,
  filePath: string | null | undefined,
  cdnBaseUrl?: string,
): string {
  if (filePath && isAbsoluteMediaUrl(filePath)) {
    return filePath;
  }
  if (cdnBaseUrl && filePath) {
    return cdnObjectUrl(cdnBaseUrl, filePath);
  }
  return `/api/audio/${trackId}`;
}

/** DJ segment audio — always local API (generated on the broadcast server). */
export function resolveDjAudioUrl(segmentId: string): string {
  return `/api/audio/dj/${segmentId}`;
}
