#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [ ! -x .venv/bin/uvicorn ] || [ ! -d frontend/node_modules ]; then
  echo "Dependencies are not installed. Run ./setup.sh first."
  exit 1
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg is missing. Install it with: brew install ffmpeg"
  exit 1
fi

cleanup() {
  [ -z "$BACKEND_PID" ] || kill "$BACKEND_PID" 2>/dev/null || true
  [ -z "$FRONTEND_PID" ] || kill "$FRONTEND_PID" 2>/dev/null || true
}
BACKEND_PID=""
FRONTEND_PID=""
trap cleanup EXIT INT TERM

.venv/bin/uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8000 &
BACKEND_PID=$!
npm --prefix frontend run dev -- --host 127.0.0.1 &
FRONTEND_PID=$!

echo "Listening Lab is running at http://127.0.0.1:5173"
wait "$BACKEND_PID" "$FRONTEND_PID"
