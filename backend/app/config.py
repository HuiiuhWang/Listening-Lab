from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("LISTENING_DATA_DIR", BACKEND_DIR / "data")).resolve()
MATERIALS_DIR = DATA_DIR / "materials"
DB_PATH = DATA_DIR / "listening.sqlite3"
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "mlx-community/whisper-small-mlx")

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".mp4", ".mov"}
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(8 * 1024 * 1024 * 1024)))


def ensure_data_dirs() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MATERIALS_DIR.mkdir(parents=True, exist_ok=True)
