#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "FFmpeg is missing. Install it with: brew install ffmpeg"
  exit 1
fi

PYTHON_BIN=""
for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
  if command -v "$candidate" >/dev/null 2>&1; then
    if "$candidate" -c 'import sys; raise SystemExit(sys.version_info < (3, 10))'; then
      PYTHON_BIN="$candidate"
      break
    fi
  fi
done

if [ -z "$PYTHON_BIN" ]; then
  echo "Python 3.10+ is missing. Install it with: brew install python@3.12"
  exit 1
fi

"$PYTHON_BIN" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r backend/requirements.txt
npm --prefix frontend --cache frontend/.npm-cache install

echo "Setup complete. Run ./start.sh"
