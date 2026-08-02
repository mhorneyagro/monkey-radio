export interface MoodScore {
  label: string;
  score: number;
}

const HIGH_ENERGY = new Set([
  "energetic",
  "aggressive",
  "epic",
  "powerful",
  "fast",
  "upbeat",
  "action",
  "sport",
]);

const LOW_ENERGY = new Set([
  "calm",
  "relaxing",
  "dreamy",
  "meditative",
  "soft",
  "slow",
  "peaceful",
  "ambient",
]);

const POSITIVE = new Set([
  "happy",
  "hopeful",
  "romantic",
  "uplifting",
  "cheerful",
  "fun",
  "positive",
  "bright",
]);

const NEGATIVE = new Set([
  "sad",
  "melancholic",
  "dark",
  "scary",
  "gloomy",
  "depressing",
  "negative",
  "melancholy",
]);

export function deriveEnergyValence(moods: MoodScore[]): {
  energy: number;
  valence: number;
} {
  if (moods.length === 0) {
    return { energy: 0.5, valence: 0.5 };
  }

  let energySum = 0;
  let energyWeight = 0;
  let valenceSum = 0;
  let valenceWeight = 0;

  for (const mood of moods) {
    const label = mood.label.toLowerCase();
    const weight = mood.score;

    if (HIGH_ENERGY.has(label)) {
      energySum += weight;
      energyWeight += weight;
    } else if (LOW_ENERGY.has(label)) {
      energySum += (1 - weight) * weight;
      energyWeight += weight;
    }

    if (POSITIVE.has(label)) {
      valenceSum += weight;
      valenceWeight += weight;
    } else if (NEGATIVE.has(label)) {
      valenceSum += (1 - weight) * weight;
      valenceWeight += weight;
    }
  }

  const energy =
    energyWeight > 0 ? energySum / energyWeight : 0.5;
  const valence =
    valenceWeight > 0 ? valenceSum / valenceWeight : 0.5;

  return {
    energy: Math.round(Math.min(1, Math.max(0, energy)) * 1000) / 1000,
    valence: Math.round(Math.min(1, Math.max(0, valence)) * 1000) / 1000,
  };
}

export function buildSearchText(fields: {
  displayName?: string | null;
  title?: string | null;
  genre: string;
  llmGenre?: string | null;
  prompt?: string | null;
  moods?: string[];
  bpm?: number | null;
  musicalKey?: string | null;
}): string {
  return [
    fields.displayName,
    fields.title,
    fields.genre,
    fields.llmGenre,
    fields.prompt,
    fields.musicalKey,
    fields.bpm != null ? `${Math.round(fields.bpm)} bpm` : null,
    ...(fields.moods ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function energyLevelBounds(
  level: "low" | "medium" | "high",
): { min: number; max: number } {
  switch (level) {
    case "low":
      return { min: 0, max: 0.4 };
    case "high":
      return { min: 0.6, max: 1 };
    default:
      return { min: 0.35, max: 0.65 };
  }
}
