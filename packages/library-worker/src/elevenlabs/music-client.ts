export interface ComposeMusicOptions {
  apiKey: string;
  prompt: string;
  musicLengthMs: number;
  modelId: string;
  forceInstrumental: boolean;
  outputFormat?: string;
}

export interface ComposedTrack {
  audio: Buffer;
  durationMs: number;
}

export async function composeMusic(
  options: ComposeMusicOptions,
): Promise<ComposedTrack> {
  const outputFormat = options.outputFormat ?? "mp3_44100_128";
  const url = new URL("https://api.elevenlabs.io/v1/music");
  url.searchParams.set("output_format", outputFormat);

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": options.apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      prompt: options.prompt,
      music_length_ms: options.musicLengthMs,
      model_id: options.modelId,
      force_instrumental: options.forceInstrumental,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const keyHint = options.apiKey.slice(0, 8);
    throw new Error(
      `ElevenLabs Music API failed (${response.status}) [key ${keyHint}…]: ${body.slice(0, 300)}`,
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  if (audio.length === 0) {
    throw new Error("ElevenLabs Music API returned empty audio");
  }

  return {
    audio,
    durationMs: options.musicLengthMs,
  };
}
