import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  GenerationJob,
  JobStatus,
  Track,
  TrackStatus,
  BroadcastState,
  PlaybackLogEntry,
  DjSegment,
  ChatMessage,
} from "./types.js";

const MIGRATIONS = `
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  suno_job_id TEXT,
  suno_track_id TEXT,
  title TEXT,
  genre TEXT NOT NULL,
  mood_tags TEXT,
  prompt TEXT NOT NULL,
  file_path TEXT,
  duration_sec REAL,
  status TEXT NOT NULL,
  error TEXT,
  generated_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tracks_genre_status ON tracks(genre, status);

CREATE TABLE IF NOT EXISTS generation_jobs (
  id TEXT PRIMARY KEY,
  genre TEXT NOT NULL,
  prompt TEXT NOT NULL,
  suno_job_id TEXT,
  status TEXT NOT NULL,
  track_id TEXT REFERENCES tracks(id),
  attempts INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS playback_log (
  id TEXT PRIMARY KEY,
  track_id TEXT REFERENCES tracks(id),
  played_at TEXT DEFAULT (datetime('now')),
  genre TEXT
);

CREATE TABLE IF NOT EXISTS dj_segments (
  id TEXT PRIMARY KEY,
  script_text TEXT NOT NULL,
  file_path TEXT,
  track_before TEXT REFERENCES tracks(id),
  track_after TEXT REFERENCES tracks(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS broadcast_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  current_genre TEXT,
  current_mood TEXT,
  last_dj_at TEXT,
  messages_snapshot TEXT
);

INSERT OR IGNORE INTO broadcast_state (id) VALUES (1);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  message TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'mock',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
`;

function migrate(db: MonkeyRadioDb): void {
  const columns = db
    .prepare(`PRAGMA table_info(broadcast_state)`)
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((c) => c.name));

  if (!names.has("current_track_id")) {
    db.exec(`ALTER TABLE broadcast_state ADD COLUMN current_track_id TEXT`);
  }
  if (!names.has("track_started_at")) {
    db.exec(`ALTER TABLE broadcast_state ADD COLUMN track_started_at TEXT`);
  }
  if (!names.has("current_phase")) {
    db.exec(`ALTER TABLE broadcast_state ADD COLUMN current_phase TEXT`);
  }
  if (!names.has("current_dj_segment_id")) {
    db.exec(
      `ALTER TABLE broadcast_state ADD COLUMN current_dj_segment_id TEXT`,
    );
  }
  if (!names.has("dj_started_at")) {
    db.exec(`ALTER TABLE broadcast_state ADD COLUMN dj_started_at TEXT`);
  }
  if (!names.has("skip_track")) {
    db.exec(`ALTER TABLE broadcast_state ADD COLUMN skip_track INTEGER DEFAULT 0`);
  }

  const djColumns = db
    .prepare(`PRAGMA table_info(dj_segments)`)
    .all() as Array<{ name: string }>;
  const djNames = new Set(djColumns.map((c) => c.name));

  if (!djNames.has("duration_sec")) {
    db.exec(`ALTER TABLE dj_segments ADD COLUMN duration_sec REAL`);
  }

  const trackColumns = db
    .prepare(`PRAGMA table_info(tracks)`)
    .all() as Array<{ name: string }>;
  const trackNames = new Set(trackColumns.map((c) => c.name));

  const trackMigrations: Array<[string, string]> = [
    ["display_name", "TEXT"],
    ["youtube_url", "TEXT"],
    ["llm_genre", "TEXT"],
    ["bpm", "REAL"],
    ["musical_key", "TEXT"],
    ["energy", "REAL"],
    ["valence", "REAL"],
    ["search_text", "TEXT"],
  ];

  for (const [name, type] of trackMigrations) {
    if (!trackNames.has(name)) {
      db.exec(`ALTER TABLE tracks ADD COLUMN ${name} ${type}`);
    }
  }

  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_tracks_search ON tracks(status, genre, energy)`,
  );
}

export type MonkeyRadioDb = Database.Database;

export function openDatabase(databasePath: string): MonkeyRadioDb {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(MIGRATIONS);
  migrate(db);
  return db;
}

export function insertTrack(
  db: MonkeyRadioDb,
  track: {
    id: string;
    genre: string;
    prompt: string;
    status?: TrackStatus;
  },
): void {
  db.prepare(
    `INSERT INTO tracks (id, genre, prompt, status) VALUES (?, ?, ?, ?)`,
  ).run(track.id, track.genre, track.prompt, track.status ?? "pending");
}

export function insertReadyTrack(
  db: MonkeyRadioDb,
  track: {
    id: string;
    genre: string;
    title: string;
    displayName?: string;
    youtubeUrl?: string | null;
    llmGenre?: string | null;
    prompt: string;
    filePath: string;
    durationSec: number | null;
    externalId: string;
    bpm?: number | null;
    musicalKey?: string | null;
    energy?: number | null;
    valence?: number | null;
    searchText?: string | null;
    moodTags: Record<string, unknown>;
  },
): void {
  const now = new Date().toISOString();
  const displayName = track.displayName ?? track.title;
  db.prepare(
    `INSERT INTO tracks (
      id, genre, title, display_name, youtube_url, llm_genre, prompt,
      file_path, duration_sec, status, suno_track_id, mood_tags, generated_at,
      bpm, musical_key, energy, valence, search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    track.id,
    track.genre,
    track.title,
    displayName,
    track.youtubeUrl ?? null,
    track.llmGenre ?? null,
    track.prompt,
    track.filePath,
    track.durationSec,
    track.externalId,
    JSON.stringify(track.moodTags),
    now,
    track.bpm ?? null,
    track.musicalKey ?? null,
    track.energy ?? null,
    track.valence ?? null,
    track.searchText ?? null,
  );
}

export function trackExistsByExternalId(
  db: MonkeyRadioDb,
  externalId: string,
): boolean {
  const row = db
    .prepare(`SELECT 1 FROM tracks WHERE suno_track_id = ? LIMIT 1`)
    .get(externalId);
  return row !== undefined;
}

export function deleteTracksByIds(db: MonkeyRadioDb, ids: string[]): number {
  if (ids.length === 0) return 0;

  const placeholders = ids.map(() => "?").join(", ");

  db.prepare(`DELETE FROM playback_log WHERE track_id IN (${placeholders})`).run(
    ...ids,
  );
  db.prepare(`DELETE FROM generation_jobs WHERE track_id IN (${placeholders})`).run(
    ...ids,
  );
  db.prepare(
    `UPDATE dj_segments SET track_before = NULL WHERE track_before IN (${placeholders})`,
  ).run(...ids);
  db.prepare(
    `UPDATE dj_segments SET track_after = NULL WHERE track_after IN (${placeholders})`,
  ).run(...ids);
  db.prepare(
    `UPDATE broadcast_state SET current_track_id = NULL WHERE current_track_id IN (${placeholders})`,
  ).run(...ids);
  db.prepare(`DELETE FROM tracks WHERE id IN (${placeholders})`).run(...ids);

  return ids.length;
}

export function deleteTemporaryReadyTracks(db: MonkeyRadioDb): number {
  const rows = db
    .prepare(
      `SELECT id, file_path FROM tracks
       WHERE status = 'ready' AND json_extract(mood_tags, '$.temporary') = 1`,
    )
    .all() as Array<{ id: string; file_path: string | null }>;

  if (rows.length === 0) return 0;

  return deleteTracksByIds(
    db,
    rows.map((row) => row.id),
  );
}

export function deleteNonUserReadyTracks(db: MonkeyRadioDb): number {
  const rows = db
    .prepare(
      `SELECT id FROM tracks
       WHERE status = 'ready'
         AND COALESCE(json_extract(mood_tags, '$.user_owned'), 0) != 1`,
    )
    .all() as Array<{ id: string }>;

  if (rows.length === 0) return 0;

  return deleteTracksByIds(
    db,
    rows.map((row) => row.id),
  );
}

export function findTracksByTitle(db: MonkeyRadioDb, query: string): Track[] {
  const pattern = `%${query.trim()}%`;
  return db
    .prepare(
      `SELECT * FROM tracks
       WHERE title LIKE ? OR display_name LIKE ? OR search_text LIKE ?
       ORDER BY title`,
    )
    .all(pattern, pattern, pattern) as Track[];
}

export function insertGenerationJob(
  db: MonkeyRadioDb,
  job: {
    id: string;
    genre: string;
    prompt: string;
    trackId: string;
    status?: JobStatus;
  },
): void {
  db.prepare(
    `INSERT INTO generation_jobs (id, genre, prompt, track_id, status)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(job.id, job.genre, job.prompt, job.trackId, job.status ?? "queued");
}

export function getTrackById(db: MonkeyRadioDb, id: string): Track | undefined {
  return db.prepare(`SELECT * FROM tracks WHERE id = ?`).get(id) as
    | Track
    | undefined;
}

export function getTracksWithYouTubeUrl(db: MonkeyRadioDb): Track[] {
  return db
    .prepare(
      `SELECT * FROM tracks
       WHERE youtube_url IS NOT NULL AND youtube_url != ''
       ORDER BY display_name, title`,
    )
    .all() as Track[];
}

export function getReadyTracksWithoutYoutube(
  db: MonkeyRadioDb,
  options: { limit?: number; trackId?: string } = {},
): Track[] {
  if (options.trackId) {
    const track = getTrackById(db, options.trackId);
    if (!track || track.status !== "ready" || !track.file_path) return [];
    return [track];
  }

  const limit = options.limit ?? 10_000;
  return db
    .prepare(
      `SELECT * FROM tracks
       WHERE status = 'ready'
         AND file_path IS NOT NULL
         AND (youtube_url IS NULL OR youtube_url = '')
         AND (title IS NULL OR title NOT LIKE '%mock track%')
         AND (display_name IS NULL OR display_name NOT LIKE '%mock track%')
       ORDER BY created_at ASC
       LIMIT ?`,
    )
    .all(limit) as Track[];
}

export function getJobById(
  db: MonkeyRadioDb,
  id: string,
): GenerationJob | undefined {
  return db.prepare(`SELECT * FROM generation_jobs WHERE id = ?`).get(id) as
    | GenerationJob
    | undefined;
}

export function updateTrack(
  db: MonkeyRadioDb,
  id: string,
  fields: Partial<
    Pick<
      Track,
      | "suno_job_id"
      | "suno_track_id"
      | "title"
      | "display_name"
      | "youtube_url"
      | "llm_genre"
      | "bpm"
      | "musical_key"
      | "energy"
      | "valence"
      | "search_text"
      | "mood_tags"
      | "file_path"
      | "duration_sec"
      | "status"
      | "error"
      | "generated_at"
    >
  >,
): void {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  db.prepare(`UPDATE tracks SET ${setClause} WHERE id = ?`).run(...values, id);
}

export function updateJob(
  db: MonkeyRadioDb,
  id: string,
  fields: Partial<
    Pick<GenerationJob, "suno_job_id" | "status" | "attempts" | "updated_at">
  >,
): void {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  db.prepare(`UPDATE generation_jobs SET ${setClause} WHERE id = ?`).run(
    ...values,
    id,
  );
}

export function getQueuedJobs(db: MonkeyRadioDb): GenerationJob[] {
  return db
    .prepare(
      `SELECT * FROM generation_jobs WHERE status = 'queued' ORDER BY created_at ASC`,
    )
    .all() as GenerationJob[];
}

export function claimNextQueuedJob(
  db: MonkeyRadioDb,
): GenerationJob | undefined {
  const job = db
    .prepare(
      `SELECT * FROM generation_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
    )
    .get() as GenerationJob | undefined;

  if (!job) return undefined;

  const now = new Date().toISOString();
  const result = db
    .prepare(
      `UPDATE generation_jobs SET status = 'submitted', updated_at = ?
       WHERE id = ? AND status = 'queued'`,
    )
    .run(now, job.id);

  if (result.changes === 0) return undefined;

  return { ...job, status: "submitted", updated_at: now };
}

export function getFailedJobs(db: MonkeyRadioDb): GenerationJob[] {
  return db
    .prepare(
      `SELECT * FROM generation_jobs WHERE status = 'failed' ORDER BY updated_at DESC`,
    )
    .all() as GenerationJob[];
}

export function requeueFailedJob(db: MonkeyRadioDb, jobId: string): void {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE generation_jobs SET status = 'queued', updated_at = ? WHERE id = ?`,
  ).run(now, jobId);

  const job = getJobById(db, jobId);
  if (job?.track_id) {
    updateTrack(db, job.track_id, { status: "pending", error: null });
  }
}

export function getTrackCountsByGenreAndStatus(
  db: MonkeyRadioDb,
): Record<string, Record<string, number>> {
  const rows = db
    .prepare(
      `SELECT genre, status, COUNT(*) as count
       FROM tracks
       GROUP BY genre, status
       ORDER BY genre, status`,
    )
    .all() as Array<{ genre: string; status: string; count: number }>;

  const result: Record<string, Record<string, number>> = {};
  for (const row of rows) {
    if (!result[row.genre]) result[row.genre] = {};
    result[row.genre][row.status] = row.count;
  }
  return result;
}

export function getReadyTrackCountByGenre(
  db: MonkeyRadioDb,
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT genre, COUNT(*) as count
       FROM tracks
       WHERE status = 'ready'
       GROUP BY genre`,
    )
    .all() as Array<{ genre: string; count: number }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.genre] = row.count;
  }
  return result;
}

export function countActiveJobs(db: MonkeyRadioDb): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM generation_jobs
       WHERE status IN ('submitted', 'polling')`,
    )
    .get() as { count: number };
  return row.count;
}

export function countPendingJobs(db: MonkeyRadioDb): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM generation_jobs
       WHERE status IN ('queued', 'submitted', 'polling')`,
    )
    .get() as { count: number };
  return row.count;
}

export function listTracks(
  db: MonkeyRadioDb,
  options: { genre?: string; status?: TrackStatus; limit?: number } = {},
): Track[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (options.genre) {
    clauses.push("genre = ?");
    params.push(options.genre);
  }
  if (options.status) {
    clauses.push("status = ?");
    params.push(options.status);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limit = options.limit ?? 100;

  return db
    .prepare(
      `SELECT * FROM tracks ${where} ORDER BY created_at DESC LIMIT ?`,
    )
    .all(...params, limit) as Track[];
}

export function getBroadcastState(db: MonkeyRadioDb): BroadcastState | undefined {
  return db.prepare(`SELECT * FROM broadcast_state WHERE id = 1`).get() as
    | BroadcastState
    | undefined;
}

export function getRecentPlaybackLog(
  db: MonkeyRadioDb,
  limit = 20,
): PlaybackLogEntry[] {
  return db
    .prepare(
      `SELECT pl.* FROM playback_log pl
       ORDER BY pl.played_at DESC LIMIT ?`,
    )
    .all(limit) as PlaybackLogEntry[];
}

export function getRecentPlaybackWithTracks(
  db: MonkeyRadioDb,
  limit = 20,
): Array<PlaybackLogEntry & { title: string | null }> {
  return db
    .prepare(
      `SELECT pl.*, t.title
       FROM playback_log pl
       LEFT JOIN tracks t ON t.id = pl.track_id
       ORDER BY pl.played_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<PlaybackLogEntry & { title: string | null }>;
}

export function getGenerationJobSummary(
  db: MonkeyRadioDb,
): Record<string, number> {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as count FROM generation_jobs GROUP BY status`,
    )
    .all() as Array<{ status: string; count: number }>;

  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.status] = row.count;
  }
  return result;
}

export function getRecentlyPlayedTrackIds(
  db: MonkeyRadioDb,
  limit = 50,
): string[] {
  const rows = db
    .prepare(
      `SELECT track_id FROM playback_log
       WHERE track_id IS NOT NULL
       ORDER BY played_at DESC
       LIMIT ?`,
    )
    .all(limit) as Array<{ track_id: string }>;

  return rows.map((r) => r.track_id);
}

export function getReadyTrackCount(db: MonkeyRadioDb): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count FROM tracks
       WHERE status = 'ready' AND file_path IS NOT NULL`,
    )
    .get() as { count: number };
  return row.count;
}

export function getAllReadyTracks(db: MonkeyRadioDb): Track[] {
  return db
    .prepare(
      `SELECT * FROM tracks
       WHERE status = 'ready' AND file_path IS NOT NULL
       ORDER BY created_at ASC`,
    )
    .all() as Track[];
}

export function getReadyTracksByGenre(
  db: MonkeyRadioDb,
  genre: string,
): Track[] {
  return db
    .prepare(
      `SELECT * FROM tracks
       WHERE genre = ? AND status = 'ready' AND file_path IS NOT NULL
       ORDER BY created_at ASC`,
    )
    .all(genre) as Track[];
}

export function insertPlaybackLog(
  db: MonkeyRadioDb,
  entry: { id: string; trackId: string; genre: string },
): void {
  db.prepare(
    `INSERT INTO playback_log (id, track_id, genre) VALUES (?, ?, ?)`,
  ).run(entry.id, entry.trackId, entry.genre);
}

export function updateBroadcastState(
  db: MonkeyRadioDb,
  fields: Partial<
    Pick<
      BroadcastState,
      | "current_genre"
      | "current_mood"
      | "last_dj_at"
      | "messages_snapshot"
      | "current_track_id"
      | "track_started_at"
      | "current_phase"
      | "current_dj_segment_id"
      | "dj_started_at"
      | "skip_track"
    >
  >,
): void {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return;

  const setClause = entries.map(([k]) => `${k} = ?`).join(", ");
  const values = entries.map(([, v]) => v);
  db.prepare(`UPDATE broadcast_state SET ${setClause} WHERE id = 1`).run(
    ...values,
  );
}

export function getNowPlaying(
  db: MonkeyRadioDb,
): { track: Track; state: BroadcastState } | null {
  const state = getBroadcastState(db);
  if (!state?.current_track_id) return null;

  const track = getTrackById(db, state.current_track_id);
  if (!track) return null;

  return { track, state };
}

export function insertDjSegment(
  db: MonkeyRadioDb,
  segment: {
    id: string;
    scriptText: string;
    filePath: string | null;
    trackBefore: string | null;
    trackAfter: string | null;
    durationSec?: number | null;
  },
): void {
  db.prepare(
    `INSERT INTO dj_segments (id, script_text, file_path, track_before, track_after, duration_sec)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    segment.id,
    segment.scriptText,
    segment.filePath,
    segment.trackBefore,
    segment.trackAfter,
    segment.durationSec ?? null,
  );
}

export function getDjSegmentById(
  db: MonkeyRadioDb,
  id: string,
): DjSegment | undefined {
  return db
    .prepare(`SELECT * FROM dj_segments WHERE id = ?`)
    .get(id) as DjSegment | undefined;
}

export function getRecentDjSegments(
  db: MonkeyRadioDb,
  limit = 10,
): DjSegment[] {
  return db
    .prepare(
      `SELECT * FROM dj_segments ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as DjSegment[];
}

export function getRecentPlayedTracks(
  db: MonkeyRadioDb,
  limit = 3,
): Track[] {
  return db
    .prepare(
      `SELECT t.*
       FROM playback_log pl
       JOIN tracks t ON t.id = pl.track_id
       ORDER BY pl.played_at DESC
       LIMIT ?`,
    )
    .all(limit) as Track[];
}

export function insertChatMessage(
  db: MonkeyRadioDb,
  message: {
    id: string;
    username: string;
    message: string;
    source?: string;
    createdAt?: string;
  },
): void {
  db.prepare(
    `INSERT OR IGNORE INTO chat_messages (id, username, message, source, created_at)
     VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
  ).run(
    message.id,
    message.username,
    message.message,
    message.source ?? "user",
    message.createdAt ?? null,
  );
}

export function getRecentChatMessages(
  db: MonkeyRadioDb,
  limit = 50,
  options?: { excludeSources?: string[] },
): ChatMessage[] {
  const excludeSources = options?.excludeSources ?? [];
  const rows =
    excludeSources.length > 0
      ? (db
          .prepare(
            `SELECT id, username, message, created_at
             FROM chat_messages
             WHERE source NOT IN (${excludeSources.map(() => "?").join(", ")})
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
          )
          .all(...excludeSources, limit) as Array<{
          id: string;
          username: string;
          message: string;
          created_at: string;
        }>)
      : (db
          .prepare(
            `SELECT id, username, message, created_at
             FROM chat_messages
             ORDER BY created_at DESC, id DESC
             LIMIT ?`,
          )
          .all(limit) as Array<{
          id: string;
          username: string;
          message: string;
          created_at: string;
        }>);

  return rows
    .map((row) => ({
      id: row.id,
      username: row.username,
      message: row.message,
      timestamp: row.created_at,
    }))
    .reverse();
}

export function getBroadcastPlayback(db: MonkeyRadioDb): {
  state: BroadcastState;
  track: Track | null;
  djSegment: DjSegment | null;
} | null {
  const state = getBroadcastState(db);
  if (!state) return null;

  const track = state.current_track_id
    ? (getTrackById(db, state.current_track_id) ?? null)
    : null;
  const djSegment = state.current_dj_segment_id
    ? (getDjSegmentById(db, state.current_dj_segment_id) ?? null)
    : null;

  return { state, track, djSegment };
}
