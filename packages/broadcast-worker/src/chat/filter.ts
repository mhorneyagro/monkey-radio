const TRACK_LINK_PREFIX = "🎵 Take me to this song:";

export interface DjChatFilterOptions {
  /** YouTube live chat: message author is the stream channel owner. */
  isChatOwner?: boolean;
  /** Extra display names to ignore (case-insensitive). */
  ignoreUsernames?: string[];
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function isIgnoredUsername(
  username: string,
  ignoreUsernames: string[] | undefined,
): boolean {
  if (!ignoreUsernames?.length) return false;
  const normalized = normalizeUsername(username);
  return ignoreUsernames.some(
    (entry) => normalizeUsername(entry) === normalized,
  );
}

/** Returns true when a chat message should influence the DJ or playlist. */
export function shouldIncludeChatForDj(
  message: { username: string; message: string },
  options: DjChatFilterOptions = {},
): boolean {
  if (options.isChatOwner) return false;
  if (isIgnoredUsername(message.username, options.ignoreUsernames)) {
    return false;
  }
  if (message.message.trimStart().startsWith(TRACK_LINK_PREFIX)) {
    return false;
  }
  return true;
}

export function parseChatIgnoreUsernames(
  raw: string | undefined,
): string[] | undefined {
  if (!raw?.trim()) return undefined;
  const names = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return names.length > 0 ? names : undefined;
}
