export interface TrackNameInput {
  file: string;
  llmGenre: string;
  musicPrompt: string;
  bpm: number;
  key: string;
  moods: string[];
  monkeyRadioGenre: string;
}

export interface TrackNameResult {
  file: string;
  displayName: string;
}

export interface NameTrackOptions {
  openaiApiKey: string;
  llmModel: string;
  existingNames: string[];
}

const SYSTEM_PROMPT = `You name instrumental music tracks for a 24/7 radio station.

Given metadata about a track, invent a short, catchy, unique song title.
Titles should feel like real song names — evocative, memorable, 1-4 words.
Do not use the genre label verbatim. Do not use generic titles like "Untitled" or "Track 1".

Return JSON only:
{ "displayName": "Song Title Here" }`;

export async function generateTrackName(
  input: TrackNameInput,
  options: NameTrackOptions,
): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.llmModel,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            llmGenre: input.llmGenre,
            musicPrompt: input.musicPrompt,
            bpm: input.bpm,
            key: input.key,
            moods: input.moods,
            mappedGenre: input.monkeyRadioGenre,
            existingNames: options.existingNames,
            instruction:
              "Pick a title not in existingNames. Make it distinct and catchy.",
          }),
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI API failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty response");

  const parsed = JSON.parse(content) as { displayName?: string };
  if (!parsed.displayName?.trim()) {
    throw new Error(`Invalid track name JSON: ${content}`);
  }

  return parsed.displayName.trim();
}
