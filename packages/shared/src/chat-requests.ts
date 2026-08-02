export interface ChatMusicRequest {
  style?: string;
  username?: string;
  rawMessage?: string;
}

const PLAY_PATTERNS = [
  /\b(?:play|spin|queue|put on|gimme|give us|want|need|more)\s+(?:some\s+)?([a-z][a-z0-9\s-]{1,30}?)(?:\s+(?:next|now|please|music|song|songs|tracks?))?\b/i,
  /\b([a-z][a-z0-9\s-]{1,30}?)\s+(?:next|please)\b/i,
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "some",
  "this",
  "that",
  "me",
  "us",
  "it",
  "my",
  "your",
  "our",
]);

function normalizeStyle(raw: string): string | undefined {
  const style = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!style || style.length < 3 || STOP_WORDS.has(style)) return undefined;
  return style;
}

export function parseChatMusicRequest(message: string): ChatMusicRequest | null {
  for (const pattern of PLAY_PATTERNS) {
    const match = message.match(pattern);
    if (!match?.[1]) continue;

    const style = normalizeStyle(match[1]);
    if (style) {
      return { style, rawMessage: message };
    }
  }

  return null;
}

export function extractLatestChatRequest(
  messages: Array<{ username: string; message: string }>,
): (ChatMusicRequest & { username: string }) | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const entry = messages[i];
    const parsed = parseChatMusicRequest(entry.message);
    if (parsed) {
      return { ...parsed, username: entry.username };
    }
  }
  return null;
}
