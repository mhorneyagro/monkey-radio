#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-all}"

restore_database() {
  local db_path="${DATABASE_PATH:-/app/data/monkey-radio.db}"
  local db_dir
  db_dir="$(dirname "$db_path")"
  mkdir -p "$db_dir"

  if [ -f "$db_path" ]; then
    echo "[entrypoint] Database already present at $db_path"
    return
  fi

  if [ -z "${R2_BUCKET:-}" ] || [ -z "${AWS_ACCESS_KEY_ID:-}" ] || [ -z "${AWS_SECRET_ACCESS_KEY:-}" ]; then
    echo "[entrypoint] No local database and R2 restore not configured — starting fresh"
    return
  fi

  local endpoint="${R2_ENDPOINT:-}"
  if [ -z "$endpoint" ]; then
    echo "[entrypoint] R2_ENDPOINT not set — cannot restore database"
    return
  fi

  echo "[entrypoint] Restoring database from R2 (_meta/monkey-radio.db)…"
  if aws s3 cp "s3://${R2_BUCKET}/_meta/monkey-radio.db" "$db_path" \
    --endpoint-url "$endpoint" \
    --region auto; then
    echo "[entrypoint] Database restored to $db_path"
  else
    echo "[entrypoint] Database restore failed — broadcast may not start until library is seeded"
  fi
}

start_pulseaudio() {
  if PULSE_SERVER="${PULSE_SERVER:-unix:/tmp/pulse/native}" pactl info >/dev/null 2>&1; then
    echo "[entrypoint] PulseAudio already running"
    return 0
  fi

  mkdir -p /tmp/pulse /root/.config/pulse /var/run/pulse /var/lib/pulse

  if [ "$(id -u)" -eq 0 ]; then
    pulseaudio --system --daemonize --exit-idle-time=-1 --disallow-exit --log-target=stderr
    export PULSE_SERVER=unix:/var/run/pulse/native
  else
    pulseaudio --daemonize --exit-idle-time=-1 --disallow-exit \
      --log-target=stderr --file=/tmp/pulse/native
    export PULSE_SERVER=unix:/tmp/pulse/native
  fi

  sleep 2
  if ! PULSE_SERVER="$PULSE_SERVER" pactl info >/dev/null 2>&1; then
    echo "[entrypoint] PulseAudio failed to start"
    return 1
  fi

  PULSE_SERVER="$PULSE_SERVER" pactl load-module module-null-sink sink_name=stream_sink sink_properties=device.description=StreamSink
  PULSE_SERVER="$PULSE_SERVER" pactl set-default-sink stream_sink
  echo "[entrypoint] PulseAudio ready (stream_sink)"
}

start_xvfb() {
  if [ -n "${DISPLAY:-}" ] && xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "[entrypoint] Xvfb already running on $DISPLAY"
    return
  fi

  export DISPLAY="${DISPLAY:-:99}"
  Xvfb "$DISPLAY" -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
  sleep 2
  echo "[entrypoint] Xvfb started on $DISPLAY"
}

wait_for_dashboard() {
  local url="${DASHBOARD_URL:-http://localhost:${PORT:-5400}}"
  local attempts=0
  until curl -sf "${url}/health" >/dev/null; do
    attempts=$((attempts + 1))
    if [ "$attempts" -ge 60 ]; then
      echo "[entrypoint] Dashboard did not become ready"
      exit 1
    fi
    sleep 2
  done
  echo "[entrypoint] Dashboard ready at ${url}"
}

run_broadcast() {
  echo "[entrypoint] Starting broadcast worker…"
  npm run broadcast:start &
}

run_dashboard() {
  echo "[entrypoint] Starting dashboard…"
  npm run dashboard:start &
}

run_stream() {
  if [ -z "${YOUTUBE_RTMP_URL:-}" ] || [ -z "${YOUTUBE_STREAM_KEY:-}" ]; then
    echo "[entrypoint] YOUTUBE_RTMP_URL / YOUTUBE_STREAM_KEY not set — skipping stream worker"
    return
  fi

  start_xvfb
  if ! start_pulseaudio; then
    echo "[entrypoint] Stream worker skipped — PulseAudio unavailable"
    return 0
  fi
  wait_for_dashboard

  echo "[entrypoint] Starting stream worker…"
  npm run stream:start &
}

case "$SERVICE" in
  broadcast)
    run_broadcast
    wait
    ;;
  dashboard)
    run_dashboard
    wait
    ;;
  stream)
    start_xvfb
    start_pulseaudio
    wait_for_dashboard
    exec npm run stream:start
    ;;
  all)
    restore_database
    run_broadcast
    run_dashboard
    run_stream
    wait
    ;;
  *)
    echo "Unknown service: $SERVICE (use: all, broadcast, dashboard, stream)"
    exit 1
    ;;
esac
