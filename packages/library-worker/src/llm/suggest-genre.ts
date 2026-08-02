export interface GenreSuggestion {
  genre: string;
  prompt: string;
}

export interface SuggestGenreOptions {
  openaiApiKey: string;
  llmModel: string;
}

const SYSTEM_PROMPT = `You choose a music genre or style completely at random for an AI music generator.
Pick anything you like — mainstream, obscure, historical, regional, or hybrid subgenres.
Be unpredictable and varied across calls. The music should be catchy. Do not explain your choice.

Return JSON only:
{
  "genre": "short label for the genre/style you chose",
  "prompt": "detailed instrumental music prompt — catchy, mood, instrumentation, tempo, texture — in 1-2 sentences"
}`;

export async function suggestRandomGenre(
  options: SuggestGenreOptions,
): Promise<GenreSuggestion> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: options.llmModel,
      temperature: 1.1,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: "Pick a random genre and write the prompt." },
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

  const parsed = JSON.parse(content) as Partial<GenreSuggestion>;
  if (!parsed.genre?.trim() || !parsed.prompt?.trim()) {
    throw new Error(`Invalid genre suggestion JSON: ${content}`);
  }

  return {
    genre: parsed.genre.trim(),
    prompt: parsed.prompt.trim(),
  };
}
