export const GENRES = [
  { id: "jazz", prompt: "Smooth jazz, late night, instrumental, warm saxophone" },
  { id: "synthwave", prompt: "Synthwave, 80s retro, driving beat, neon atmosphere" },
  { id: "lofi", prompt: "Lo-fi hip hop, chill study beats, dusty drums, mellow" },
  { id: "ambient", prompt: "Ambient electronic, atmospheric, slow evolving pads" },
  { id: "funk", prompt: "Funk groove, slap bass, tight drums, energetic" },
  { id: "rock", prompt: "Indie rock, guitar driven, upbeat, radio friendly" },
] as const;

export type GenreId = (typeof GENRES)[number]["id"];

export function getGenrePrompt(id: string): string | undefined {
  return GENRES.find((g) => g.id === id)?.prompt;
}

export function isValidGenre(id: string): id is GenreId {
  return GENRES.some((g) => g.id === id);
}

export function getAllGenreIds(): GenreId[] {
  return GENRES.map((g) => g.id);
}
