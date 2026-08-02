import type {
  BroadcastWorkerConfig,
  ChatMessage,
  MoodDecision,
  Track,
} from "@monkey-radio/shared";
import { extractLatestChatRequest } from "@monkey-radio/shared";

async function chatCompletion(
  config: BroadcastWorkerConfig,
  system: string,
  user: string,
  maxTokens?: number,
): Promise<string> {
  if (config.llmProvider === "mock") {
    throw new Error("mock provider should not call chatCompletion");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.llmModel,
      temperature: 0.8,
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API failed (${response.status}): ${body}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");
  return content;
}

function parseMoodDecision(
  raw: string,
  fallbackStyle?: string,
): MoodDecision {
  const parsed = JSON.parse(raw) as Partial<MoodDecision> & {
    nextGenre?: string;
  };

  const nextStyle =
    (typeof parsed.nextStyle === "string" ? parsed.nextStyle.trim() : undefined) ??
    (typeof parsed.nextGenre === "string" ? parsed.nextGenre.trim() : undefined) ??
    fallbackStyle;

  const shoutouts = Array.isArray(parsed.shoutouts)
    ? parsed.shoutouts
        .filter(
          (entry): entry is { username: string; reason: string } =>
            typeof entry?.username === "string" &&
            typeof entry?.reason === "string",
        )
        .slice(0, 3)
    : [];

  return {
    nextStyle,
    mood:
      typeof parsed.mood === "string"
        ? parsed.mood
        : "Keeping the vibes smooth and steady.",
    energy:
      typeof parsed.energy === "number"
        ? Math.min(10, Math.max(1, Math.round(parsed.energy)))
        : 5,
    shoutouts,
    genreReason:
      typeof parsed.genreReason === "string"
        ? parsed.genreReason.trim()
        : undefined,
    trackHints: parseTrackHints(parsed.trackHints),
  };
}

function parseTrackHints(
  raw: unknown,
): MoodDecision["trackHints"] | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const hints = raw as Record<string, unknown>;
  const llmGenre =
    typeof hints.llmGenre === "string" ? hints.llmGenre.trim() : undefined;
  const nameContains =
    typeof hints.nameContains === "string"
      ? hints.nameContains.trim()
      : undefined;
  const mood =
    typeof hints.mood === "string" ? hints.mood.trim() : undefined;
  const energyLevel =
    hints.energyLevel === "low" ||
    hints.energyLevel === "medium" ||
    hints.energyLevel === "high"
      ? hints.energyLevel
      : undefined;

  if (!llmGenre && !nameContains && !mood && !energyLevel) return undefined;

  return { llmGenre, nameContains, mood, energyLevel };
}

function enrichMoodFromChat(
  mood: MoodDecision,
  chatMessages: ChatMessage[],
): MoodDecision {
  const request = extractLatestChatRequest(chatMessages);
  if (!request) return mood;

  const trackHints = { ...mood.trackHints };
  let nextStyle = mood.nextStyle;
  let genreReason = mood.genreReason;
  let shoutouts = mood.shoutouts;

  if (request.style) {
    trackHints.llmGenre = trackHints.llmGenre ?? request.style;
    nextStyle = nextStyle ?? request.style;
    genreReason =
      genreReason ??
      `${request.username} asked for ${request.style} in chat — searching the library`;
  }

  const alreadyShouted = shoutouts.some(
    (entry) => entry.username === request.username,
  );
  if (!alreadyShouted) {
    shoutouts = [
      {
        username: request.username,
        reason: request.rawMessage ?? request.style ?? "",
      },
      ...shoutouts,
    ].slice(0, 3);
  }

  const hasHints = Boolean(
    trackHints.llmGenre ||
      trackHints.nameContains ||
      trackHints.mood ||
      trackHints.energyLevel,
  );

  return {
    ...mood,
    nextStyle,
    genreReason,
    shoutouts,
    trackHints: hasHints ? trackHints : mood.trackHints,
  };
}

function mockMoodDecision(
  currentStyle: string | undefined,
  chatMessages: ChatMessage[],
): MoodDecision {
  const request = extractLatestChatRequest(chatMessages);
  const nextStyle = request?.style ?? currentStyle;
  const shoutouts = chatMessages.slice(-3).map((message) => ({
    username: message.username,
    reason: message.message.slice(0, 80),
  }));

  let genreReason: string;
  if (request?.style) {
    genreReason = `${request.username} asked for ${request.style} in chat`;
  } else if (chatMessages.length > 0) {
    genreReason = "No style requests — staying with the current vibe";
  } else {
    genreReason = "Quiet chat — keeping the rotation going";
  }

  const mood: MoodDecision = {
    nextStyle,
    mood: request?.style
      ? `Chat wants ${request.style} — ${request.username} called it.`
      : chatMessages.length > 0
        ? "Chat is active — riding the energy."
        : "Quiet chat tonight — staying in the pocket.",
    energy: request ? 7 : 5,
    shoutouts,
    genreReason,
    trackHints: request?.style ? { llmGenre: request.style } : undefined,
  };

  return enrichMoodFromChat(mood, chatMessages);
}

export async function decideMood(
  config: BroadcastWorkerConfig,
  params: {
    currentStyle?: string;
    recentTracks: Track[];
    chatMessages: ChatMessage[];
    availableStyles?: string[];
  },
): Promise<MoodDecision> {
  if (config.llmProvider === "mock") {
    return mockMoodDecision(params.currentStyle, params.chatMessages);
  }

  const system = `You are the programming director for Monkey Radio, a 24/7 live YouTube station.

Your job: read chat and decide what style of music plays NEXT. Styles come from the station library — there is no fixed genre list.

Return JSON:
{
  "nextStyle": "<style/genre label from availableStyles, or a keyword to search>",
  "mood": "<short vibe phrase, under 12 words>",
  "energy": <1-10>,
  "genreReason": "<one sentence: why you picked this — cite chat requests when present>",
  "trackHints": {
    "llmGenre": "<optional: search keyword, e.g. celtic, samba, folk metal>",
    "nameContains": "<optional: substring of a requested song title>",
    "mood": "<optional: mood keyword like calm, energetic, dark>",
    "energyLevel": "<optional: low | medium | high>"
  },
  "shoutouts": [{ "username": "<viewer>", "reason": "<what they said or why you're shouting them out>" }]
}

Rules:
- READ chat carefully. Honor viewer requests — this is the top priority.
- Use availableStyles when picking nextStyle. If chat requests something not in the list, set trackHints.llmGenre to search for it.
- If chat names a specific song, set trackHints.nameContains.
- If multiple requests conflict, favor the most recent.
- shoutouts: 1–3 entries max. Always shout out users who made music requests.
- genreReason must mention chat when chat influenced the decision.
- Ignore spam, slurs, bots, and meta commands.`;

  const user = JSON.stringify({
    currentStyle: params.currentStyle,
    availableStyles: params.availableStyles ?? [],
    lastTracks: params.recentTracks.map((track) => ({
      title: track.display_name ?? track.title,
      style: track.llm_genre ?? track.genre,
    })),
    chatMessages: params.chatMessages.slice(-20),
  });

  const raw = await chatCompletion(config, system, user);
  const mood = parseMoodDecision(raw, params.currentStyle);
  return enrichMoodFromChat(mood, params.chatMessages);
}

function chatRequestMatchesNextTrack(
  chatMessages: ChatMessage[],
  nextTrack: Track,
): boolean {
  const request = extractLatestChatRequest(chatMessages);
  if (!request?.style) return false;

  const style = request.style.toLowerCase();
  const haystack = [
    nextTrack.llm_genre,
    nextTrack.genre,
    nextTrack.display_name,
    nextTrack.title,
    nextTrack.search_text,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(style);
}

function mockDjScript(params: {
  lastTrack: Track;
  nextTrack: Track;
  mood: MoodDecision;
  chatMessages: ChatMessage[];
}): string {
  const shoutout = params.mood.shoutouts[0];
  const request = extractLatestChatRequest(params.chatMessages);
  const lastTitle = params.lastTrack.display_name ?? params.lastTrack.title ?? "that track";
  const nextTitle = params.nextTrack.display_name ?? params.nextTrack.title ?? "something fresh";

  if (request && chatRequestMatchesNextTrack(params.chatMessages, params.nextTrack)) {
    const ack = shoutout
      ? `${shoutout.username}, heard you — `
      : `${request.username} wanted ${request.style} — `;
    return `${ack}that was ${lastTitle}. Up next: ${nextTitle}. Monkey Radio.`;
  }

  if (shoutout) {
    return `Shoutout ${shoutout.username}. That was ${lastTitle} — up next, ${nextTitle}. Monkey Radio.`;
  }

  return `That was ${lastTitle}. Up next: ${nextTitle}. Monkey Radio.`;
}

const MAX_DJ_WORDS = 45;

function trimDjScript(script: string): string {
  const words = script.trim().split(/\s+/).filter(Boolean);
  if (words.length <= MAX_DJ_WORDS) return words.join(" ");
  return `${words.slice(0, MAX_DJ_WORDS).join(" ")}…`;
}

export async function writeDjScript(
  config: BroadcastWorkerConfig,
  params: {
    lastTrack: Track;
    nextTrack: Track;
    mood: MoodDecision;
    chatMessages: ChatMessage[];
  },
): Promise<string> {
  if (config.llmProvider === "mock") {
    return mockDjScript(params);
  }

  const system = `You are DJ Monkey on Monkey Radio — a quick voice break between songs. Short, warm, a little playful.

Write ~10–15 seconds of spoken copy (max 45 words). One or two sentences.

You MUST:
- Briefly nod to the track that just played
- Name the next track
- If shoutouts is non-empty, say at least one viewer's username out loud (e.g. "hey nightowl_42" or "shoutout JazzCat")
- If genreReason or recentChat shows someone requested a song/style, acknowledge them by username and confirm you're playing it (e.g. "you asked for celtic — here we go")
- Do not ignore chat when shoutouts or recentChat are provided

Use genreReason, shoutouts, and recentChat together. Speak directly to viewers, not about them in the third person.

Skip filler and long transitions. No stage directions — spoken words only.
Return JSON: { "script": "..." }`;

  const user = JSON.stringify({
    lastTitle: params.lastTrack.display_name ?? params.lastTrack.title,
    lastStyle: params.lastTrack.llm_genre ?? params.lastTrack.genre,
    nextTitle: params.nextTrack.display_name ?? params.nextTrack.title,
    nextStyle: params.nextTrack.llm_genre ?? params.nextTrack.genre,
    mood: params.mood.mood,
    genreReason: params.mood.genreReason,
    trackHints: params.mood.trackHints,
    shoutouts: params.mood.shoutouts.slice(0, 2),
    recentChat: params.chatMessages.slice(-8).map((message) => ({
      username: message.username,
      message: message.message,
    })),
  });

  const raw = await chatCompletion(config, system, user, 120);
  const parsed = JSON.parse(raw) as { script?: string };
  if (!parsed.script?.trim()) {
    throw new Error("LLM returned empty DJ script");
  }
  return trimDjScript(parsed.script);
}
