#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <youtube-channel-url> [output-dir] [limit]"
  echo ""
  echo "Examples:"
  echo "  $0 'https://www.youtube.com/@YourHandle'"
  echo "  $0 'https://www.youtube.com/@YourHandle' ./data/temp/youtube-import 10"
  exit 1
fi

CHANNEL_URL="${1%/}"
OUTPUT_DIR="${2:-./data/temp/youtube-import}"
LIMIT="${3:-}"

if [[ "$CHANNEL_URL" != *"/videos"* && "$CHANNEL_URL" != *"/playlists"* ]]; then
  CHANNEL_URL="${CHANNEL_URL}/videos"
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "yt-dlp is required. Install with: brew install yt-dlp"
  exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg is required. Install with: brew install ffmpeg"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

ARGS=(
  -x
  --audio-format mp3
  --audio-quality 0
  --embed-thumbnail
  --add-metadata
  --no-overwrites
  --continue
  -o "${OUTPUT_DIR}/%(title)s [%(id)s].%(ext)s"
)

if [[ -n "$LIMIT" ]]; then
  ARGS=(--playlist-end "$LIMIT" "${ARGS[@]}")
fi

echo "Channel:  $CHANNEL_URL"
echo "Output:   $OUTPUT_DIR"
if [[ -n "$LIMIT" ]]; then
  echo "Limit:    $LIMIT video(s)"
fi
echo ""

yt-dlp "${ARGS[@]}" "$CHANNEL_URL"

echo ""
echo "Done. MP3s saved to: $OUTPUT_DIR"
