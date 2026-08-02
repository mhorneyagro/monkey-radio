#!/usr/bin/env bash
set -euo pipefail

SERVICE="${1:-all}"
PULSE_RUNTIME="${PULSE_RUNTIME:-/tmp/pulse-runtime}"
PULSE_USER="${PULSE_USER:-streamer}"

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
  mkdir -p "$PULSE_RUNTIME"
  chown "$PULSE_USER:$PULSE_USER" "$PULSE_RUNTIME"
  chmod 700 "$PULSE_RUNTIME"

  export PULSE_SERVER="unix:${PULSE_RUNTIME}/pulse/native"

  if gosu "$PULSE_USER" env XDG_RUNTIME_DIR="$PULSE_RUNTIME" pactl info >/dev/null 2>&1; then
    echo "[entrypoint] PulseAudio already running"
    return 0
  fi

  gosu "$PULSE_USER" env XDG_RUNTIME_DIR="$PULSE_RUNTIME" \
    pulseaudio --daemonize --exit-idle-time=-1 --disallow-exit --log-target=stderr

  sleep 2

  if ! gosu "$PULSE_USER" env XDG_RUNTIME_DIR="$PULSE_RUNTIME" pactl info >/dev/null 2>&1; then
    echo "[entrypoint] PulseAudio failed to start"
    return 1
  fi

  gosu "$PULSE_USER" env XDG_RUNTIME_DIR="$PULSE_RUNTIME" \
    pactl load-module module-null-sink sink_name=stream_sink sink_properties=device.description=StreamSink
  gosu "$PULSE_USER" env XDG_RUNTIME_DIR="$PULSE_RUNTIME" \
    pactl set-sink-latency stream_sink 100000
  gosu "$PULSE_USER" env XDG_RUNTIME_DIR="$PULSE_RUNTIME" \
    pactl set-default-sink stream_sink

  echo "[entrypoint] PulseAudio ready (stream_sink at $PULSE_SERVER)"
}

start_xvfb() {
  export DISPLAY="${DISPLAY:-:99}"
  local width="${STREAM_WIDTH:-1280}"
  local height="${STREAM_HEIGHT:-720}"

  if command -v xdpyinfo >/dev/null 2>&1 && xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "[entrypoint] Xvfb already running on $DISPLAY"
    return 0
  fi

  pkill -f "Xvfb $DISPLAY" >/dev/null 2>&1 || true
  sleep 1

  Xvfb "$DISPLAY" -screen 0 "${width}x${height}x24" -ac +extension GLX +render -noreset &
  local attempts=0
  until { command -v xdpyinfo >/dev/null 2>&1 && xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; } || [ "$attempts" -ge 15 ]; do
    attempts=$((attempts + 1))
    sleep 1
  done

  if command -v xdpyinfo >/dev/null 2>&1 && xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; then
    echo "[entrypoint] Xvfb started on $DISPLAY (${width}x${height})"
  else
    echo "[entrypoint] Xvfb started on $DISPLAY (${width}x${height}, unverified)"
  fi
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

run_stream_worker() {
  echo "[entrypoint] Starting stream worker…"
  export HOME="/home/$PULSE_USER"
  export XDG_RUNTIME_DIR="$PULSE_RUNTIME"
  export DISPLAY="${DISPLAY:-:99}"
  gosu "$PULSE_USER" env \
    DISPLAY="$DISPLAY" \
    PULSE_SERVER="${PULSE_SERVER:-}" \
    XDG_RUNTIME_DIR="$PULSE_RUNTIME" \
    HOME="/home/$PULSE_USER" \
    npm run stream:start &
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
  run_stream_worker
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
    export HOME="/home/$PULSE_USER"
    export XDG_RUNTIME_DIR="$PULSE_RUNTIME"
    exec gosu "$PULSE_USER" env \
      DISPLAY="${DISPLAY:-:99}" \
      PULSE_SERVER="${PULSE_SERVER:-}" \
      XDG_RUNTIME_DIR="$PULSE_RUNTIME" \
      HOME="/home/$PULSE_USER" \
      npm run stream:start
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
