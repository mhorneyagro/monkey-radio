import { randomUUID } from "node:crypto";
import type {
  BroadcastWorkerConfig,
  ChatMessage,
  MonkeyRadioDb,
  MoodDecision,
  Track,
  TrackSelectionHints,
} from "@monkey-radio/shared";
import {
  extractLatestChatRequest,
  getDistinctLlmGenres,
  getRecentPlayedTracks,
  insertDjSegment,
} from "@monkey-radio/shared";
import type { ChatBuffer } from "../chat/buffer.js";
import { selectNextTrack, trackStyle } from "../playlist/selector.js";
import { decideMood, writeDjScript } from "./llm.js";
import { synthesizeDjSegment } from "./tts.js";

export interface GenrePollResult {
  genre: string;
  totalVotes: number;
}

export interface DjPipelineResult {
  segmentId: string;
  scriptText: string;
  filePath: string;
  durationSec: number;
  mood: MoodDecision;
  nextTrack: Track;
}

/** Style/hint filtering only when chat or a poll asked for something specific. */
export function audienceTrackSelection(
  chatMessages: ChatMessage[],
  mood: MoodDecision,
  pollResult?: GenrePollResult,
): { hints?: TrackSelectionHints; preferredStyle?: string } | undefined {
  const pollGenre = pollResult?.genre ?? mood.pollWinner?.genre;
  if (pollGenre) {
    return { preferredStyle: pollGenre, hints: { llmGenre: pollGenre } };
  }

  const chatRequest = extractLatestChatRequest(chatMessages);
  if (chatRequest?.style) {
    return {
      preferredStyle: chatRequest.style,
      hints: mood.trackHints ?? { llmGenre: chatRequest.style },
    };
  }

  return undefined;
}

export async function generateDjSegment(
  db: MonkeyRadioDb,
  config: BroadcastWorkerConfig,
  chatBuffer: ChatBuffer,
  params: {
    lastTrack: Track;
    pollResult?: GenrePollResult;
  },
): Promise<DjPipelineResult | null> {
  try {
    const chatMessages = chatBuffer.getRecent();
    const recentTracks = getRecentPlayedTracks(db, 3);
    const availableStyles = getDistinctLlmGenres(db);
    const mood = await decideMood(config, {
      currentStyle: trackStyle(params.lastTrack),
      recentTracks,
      chatMessages,
      availableStyles,
    });

    const audienceSelection = audienceTrackSelection(
      chatMessages,
      mood,
      params.pollResult,
    );
    const nextTrack = selectNextTrack(db, config, {
      excludeTrackId: params.lastTrack.id,
      ...audienceSelection,
    });

    const scriptText = await writeDjScript(config, {
      lastTrack: params.lastTrack,
      nextTrack,
      mood,
      chatMessages,
    });

    const segmentId = randomUUID();
    const audio = await synthesizeDjSegment(config, scriptText, segmentId);

    insertDjSegment(db, {
      id: segmentId,
      scriptText,
      filePath: audio.filePath,
      trackBefore: params.lastTrack.id,
      trackAfter: nextTrack.id,
      durationSec: audio.durationSec,
    });

    console.log(
      `[dj] generated segment (${Math.round(audio.durationSec)}s) → next: ${trackStyle(nextTrack)} — ${nextTrack.display_name ?? nextTrack.title ?? nextTrack.id}`,
    );
    if (mood.genreReason) {
      console.log(`[dj mood] ${mood.genreReason}`);
    }
    if (mood.trackHints?.llmGenre) {
      console.log(`[dj track hint] style=${mood.trackHints.llmGenre}`);
    }
    if (mood.pollWinner) {
      console.log(
        `[dj poll] winner=${mood.pollWinner.genre} (${mood.pollWinner.totalVotes} votes)`,
      );
    }
    console.log(`[dj script] ${scriptText.slice(0, 120)}…`);

    return {
      segmentId,
      scriptText,
      filePath: audio.filePath,
      durationSec: audio.durationSec,
      mood,
      nextTrack,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[dj] segment generation failed: ${message}`);
    return null;
  }
}
