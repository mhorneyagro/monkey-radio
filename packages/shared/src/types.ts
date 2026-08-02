export type TrackStatus = "pending" | "generating" | "ready" | "failed";
export type JobStatus = "queued" | "submitted" | "polling" | "done" | "failed";

export interface Track {
  id: string;
  suno_job_id: string | null;
  suno_track_id: string | null;
  title: string | null;
  display_name: string | null;
  youtube_url: string | null;
  genre: string;
  llm_genre: string | null;
  mood_tags: string | null;
  prompt: string;
  file_path: string | null;
  duration_sec: number | null;
  bpm: number | null;
  musical_key: string | null;
  energy: number | null;
  valence: number | null;
  search_text: string | null;
  status: TrackStatus;
  error: string | null;
  generated_at: string | null;
  created_at: string;
}

export interface GenerationJob {
  id: string;
  genre: string;
  prompt: string;
  suno_job_id: string | null;
  status: JobStatus;
  track_id: string | null;
  attempts: number;
  created_at: string;
  updated_at: string | null;
}

export interface PlaybackLogEntry {
  id: string;
  track_id: string | null;
  played_at: string;
  genre: string | null;
}

export interface DjSegment {
  id: string;
  script_text: string;
  file_path: string | null;
  track_before: string | null;
  track_after: string | null;
  duration_sec: number | null;
  created_at: string;
}

export interface ChatMessage {
  id: string;
  username: string;
  message: string;
  timestamp: string;
}

export type BroadcastPhase = "track" | "dj";

export interface DjShoutout {
  username: string;
  reason: string;
}

export interface MoodDecision {
  /** Style/genre label from the library DB to play next. */
  nextStyle?: string;
  mood: string;
  energy: number;
  shoutouts: DjShoutout[];
  /** Why this style was chosen — especially chat-driven requests. */
  genreReason?: string;
  /** Loose criteria for picking a specific track. */
  trackHints?: {
    llmGenre?: string;
    nameContains?: string;
    mood?: string;
    energyLevel?: "low" | "medium" | "high";
  };
  /** Winner from the live chat genre poll, when enough votes were cast. */
  pollWinner?: {
    genre: string;
    totalVotes: number;
  };
}

export interface BroadcastState {
  id: number;
  current_genre: string | null;
  current_mood: string | null;
  last_dj_at: string | null;
  messages_snapshot: string | null;
  current_track_id: string | null;
  track_started_at: string | null;
  current_phase: BroadcastPhase | null;
  current_dj_segment_id: string | null;
  dj_started_at: string | null;
  skip_track?: number | null;
}

export interface TrackMoodTags {
  plan_tier?: "pro";
  tags?: string[];
}
