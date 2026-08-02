import type { BroadcastWorkerConfig, MonkeyRadioDb } from "@monkey-radio/shared";
import { getDistinctLlmGenres } from "@monkey-radio/shared";
import {
  clearLiveChatIdCache,
  getYouTubeOAuthAccessToken,
  handleLiveChatError,
  resolveLiveChatId,
} from "./youtube-live-chat.js";

export interface GenrePollResult {
  winningGenre: string;
  totalVotes: number;
  options: Array<{ label: string; votes: number }>;
}

interface ActivePollState {
  messageId: string;
  options: string[];
}

let activePoll: ActivePollState | undefined;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function pickPollGenres(
  db: MonkeyRadioDb,
  excludeGenre?: string,
  count = 4,
): string[] {
  const genres = getDistinctLlmGenres(db);
  if (genres.length === 0) return [];

  const filtered = excludeGenre
    ? genres.filter((genre) => genre.toLowerCase() !== excludeGenre.toLowerCase())
    : genres;

  const pool = filtered.length >= 2 ? filtered : genres;
  return shuffle(pool).slice(0, Math.min(count, pool.length));
}

interface PollOptionDetails {
  optionText?: string;
  tally?: string;
}

interface PollMetadata {
  questionText?: string;
  status?: string;
  options?: PollOptionDetails[];
}

function parsePollMetadata(raw: unknown): PollMetadata | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const metadata = (raw as { metadata?: PollMetadata }).metadata;
  return metadata && typeof metadata === "object" ? metadata : undefined;
}

function tallyFromOption(option: PollOptionDetails): number {
  const parsed = Number.parseInt(option.tally ?? "0", 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resultFromMetadata(
  metadata: PollMetadata,
  optionLabels: string[],
  minVotes: number,
): GenrePollResult | null {
  const apiOptions = metadata.options ?? [];
  const options = apiOptions.map((option, index) => ({
    label: option.optionText ?? optionLabels[index] ?? `Option ${index + 1}`,
    votes: tallyFromOption(option),
  }));

  const totalVotes = options.reduce((sum, option) => sum + option.votes, 0);
  if (totalVotes < minVotes || options.length === 0) {
    return null;
  }

  let winningOption = options[0];
  for (const option of options.slice(1)) {
    if (option.votes > winningOption.votes) {
      winningOption = option;
    }
  }

  if (winningOption.votes <= 0) {
    return null;
  }

  return {
    winningGenre: winningOption.label,
    totalVotes,
    options,
  };
}

async function listActivePollMessageId(
  liveChatId: string,
  accessToken: string,
): Promise<string | undefined> {
  const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
  url.searchParams.set("liveChatId", liveChatId);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("maxResults", "1");

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`YouTube liveChatMessages.list failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    activePollItem?: { id?: string };
  };

  return data.activePollItem?.id;
}

async function transitionPollClosed(
  messageId: string,
  accessToken: string,
): Promise<PollMetadata | undefined> {
  const url = new URL(
    "https://www.googleapis.com/youtube/v3/liveChat/messages/transition",
  );
  url.searchParams.set("id", messageId);
  url.searchParams.set("status", "closed");
  url.searchParams.set("part", "snippet");

  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `YouTube liveChatMessages.transition failed (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as {
    snippet?: { pollDetails?: unknown };
  };

  return parsePollMetadata(data.snippet?.pollDetails);
}

async function createGenrePoll(
  liveChatId: string,
  accessToken: string,
  genres: string[],
): Promise<string> {
  const response = await fetch(
    "https://www.googleapis.com/youtube/v3/liveChat/messages?part=snippet",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        snippet: {
          liveChatId,
          type: "pollEvent",
          pollDetails: {
            metadata: {
              questionText: "What should we play next?",
              options: genres.map((genre) => ({ optionText: genre })),
            },
          },
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `YouTube liveChatMessages.insert poll failed (${response.status}): ${body}`,
    );
  }

  const data = (await response.json()) as { id?: string };
  if (!data.id) {
    throw new Error("YouTube poll insert returned no message id");
  }

  return data.id;
}

async function closeExistingActivePoll(
  liveChatId: string,
  accessToken: string,
): Promise<void> {
  const activeId = await listActivePollMessageId(liveChatId, accessToken);
  if (!activeId) return;

  try {
    await transitionPollClosed(activeId, accessToken);
    console.log("[poll] closed stale active poll before opening a new one");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[poll] could not close stale poll: ${message}`);
  }
}

export function isPollsEnabled(config: BroadcastWorkerConfig): boolean {
  return (
    config.youtubePollsEnabled &&
    config.chatProvider === "youtube" &&
    Boolean(config.youtubeVideoId && config.youtubeApiKey)
  );
}

export function resetPollState(): void {
  activePoll = undefined;
}

export async function openGenrePoll(
  config: BroadcastWorkerConfig,
  db: MonkeyRadioDb,
  excludeGenre?: string,
): Promise<boolean> {
  if (!isPollsEnabled(config)) return false;
  if (activePoll) return true;

  const genres = pickPollGenres(db, excludeGenre);
  if (genres.length < 2) {
    console.warn("[poll] skipped — need at least 2 genres in library");
    return false;
  }

  const accessToken = await getYouTubeOAuthAccessToken();
  if (!accessToken) {
    console.warn("[poll] skipped — YouTube OAuth not configured");
    return false;
  }

  try {
    const liveChatId = await resolveLiveChatId(config);
    if (!liveChatId) {
      console.warn("[poll] skipped — no active live chat");
      return false;
    }

    await closeExistingActivePoll(liveChatId, accessToken);

    const messageId = await createGenrePoll(liveChatId, accessToken, genres);
    activePoll = { messageId, options: genres };
    console.log(`[poll] opened: ${genres.join(" | ")}`);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[poll] open failed: ${message}`);
    handleLiveChatError(message);

    if (message.includes("preconditionCheckFailed")) {
      activePoll = undefined;
    }

    return false;
  }
}

export async function closeGenrePoll(
  config: BroadcastWorkerConfig,
  minVotes = 1,
): Promise<GenrePollResult | null> {
  if (!activePoll) return null;

  const pollState = activePoll;
  activePoll = undefined;

  const accessToken = await getYouTubeOAuthAccessToken();
  if (!accessToken) {
    console.warn("[poll] close skipped — YouTube OAuth not configured");
    return null;
  }

  try {
    const metadata = await transitionPollClosed(pollState.messageId, accessToken);
    if (!metadata) {
      console.warn("[poll] closed without result metadata");
      return null;
    }

    const result = resultFromMetadata(metadata, pollState.options, minVotes);
    if (!result) {
      console.log("[poll] closed — not enough votes to influence next track");
      return null;
    }

    console.log(
      `[poll] winner: ${result.winningGenre} (${result.totalVotes} votes) — ${result.options.map((option) => `${option.label}:${option.votes}`).join(", ")}`,
    );
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[poll] close failed: ${message}`);
    handleLiveChatError(message);
    if (message.includes("liveChatEnded")) {
      clearLiveChatIdCache();
    }
    return null;
  }
}
