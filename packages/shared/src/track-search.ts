import type { MonkeyRadioDb } from "./db.js";
import type { Track } from "./types.js";
import { energyLevelBounds } from "./track-metadata.js";

export interface FindTracksCriteria {
  genre?: string;
  llmGenre?: string;
  nameContains?: string;
  moodContains?: string;
  bpmMin?: number;
  bpmMax?: number;
  energyMin?: number;
  energyMax?: number;
  energyLevel?: "low" | "medium" | "high";
  excludeIds?: string[];
  limit?: number;
}

export interface TrackSelectionHints {
  llmGenre?: string;
  nameContains?: string;
  mood?: string;
  energyLevel?: "low" | "medium" | "high";
}

export function findTracks(
  db: MonkeyRadioDb,
  criteria: FindTracksCriteria,
): Track[] {
  const clauses = ["status = 'ready'", "file_path IS NOT NULL"];
  const params: Array<string | number> = [];

  if (criteria.genre) {
    clauses.push("genre = ?");
    params.push(criteria.genre);
  }
  if (criteria.llmGenre) {
    const pattern = `%${criteria.llmGenre}%`;
    clauses.push(
      "(llm_genre LIKE ? OR genre LIKE ? OR search_text LIKE ?)",
    );
    params.push(pattern, pattern, pattern);
  }
  if (criteria.nameContains) {
    const pattern = `%${criteria.nameContains}%`;
    clauses.push(
      "(display_name LIKE ? OR title LIKE ? OR search_text LIKE ?)",
    );
    params.push(pattern, pattern, pattern);
  }
  if (criteria.moodContains) {
    clauses.push("search_text LIKE ?");
    params.push(`%${criteria.moodContains.toLowerCase()}%`);
  }
  if (criteria.bpmMin !== undefined) {
    clauses.push("bpm >= ?");
    params.push(criteria.bpmMin);
  }
  if (criteria.bpmMax !== undefined) {
    clauses.push("bpm <= ?");
    params.push(criteria.bpmMax);
  }

  let energyMin = criteria.energyMin;
  let energyMax = criteria.energyMax;
  if (criteria.energyLevel) {
    const bounds = energyLevelBounds(criteria.energyLevel);
    energyMin = energyMin ?? bounds.min;
    energyMax = energyMax ?? bounds.max;
  }
  if (energyMin !== undefined) {
    clauses.push("energy >= ?");
    params.push(energyMin);
  }
  if (energyMax !== undefined) {
    clauses.push("energy <= ?");
    params.push(energyMax);
  }
  if (criteria.excludeIds?.length) {
    clauses.push(
      `id NOT IN (${criteria.excludeIds.map(() => "?").join(", ")})`,
    );
    params.push(...criteria.excludeIds);
  }

  const limit = criteria.limit ?? 20;
  const sql = `SELECT * FROM tracks WHERE ${clauses.join(" AND ")} ORDER BY RANDOM() LIMIT ?`;

  return db.prepare(sql).all(...params, limit) as Track[];
}

export function displayNameExists(
  db: MonkeyRadioDb,
  displayName: string,
): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM tracks
       WHERE display_name = ? OR title = ?
       LIMIT 1`,
    )
    .get(displayName, displayName);
  return row !== undefined;
}

export function getDistinctLlmGenres(db: MonkeyRadioDb): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT COALESCE(NULLIF(llm_genre, ''), genre) AS label
       FROM tracks
       WHERE status = 'ready'
         AND COALESCE(NULLIF(llm_genre, ''), genre) IS NOT NULL
       ORDER BY label ASC`,
    )
    .all() as Array<{ label: string }>;

  return rows.map((row) => row.label);
}
