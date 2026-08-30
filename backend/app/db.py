from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator

from .config import DB_PATH, ensure_data_dirs


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def connect() -> Iterator[sqlite3.Connection]:
    ensure_data_dirs()
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS materials (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                source_path TEXT NOT NULL,
                audio_path TEXT,
                duration REAL NOT NULL DEFAULT 0,
                status TEXT NOT NULL DEFAULT 'processing',
                transcript_source TEXT NOT NULL DEFAULT 'whisper',
                folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL,
                completed INTEGER NOT NULL DEFAULT 0,
                completed_at TEXT,
                error TEXT,
                current_sentence INTEGER NOT NULL DEFAULT 0,
                current_position REAL NOT NULL DEFAULT 0,
                playback_rate REAL NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sentences (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
                sentence_index INTEGER NOT NULL,
                start REAL NOT NULL,
                end REAL NOT NULL,
                text TEXT NOT NULL,
                words_json TEXT NOT NULL DEFAULT '[]',
                UNIQUE(material_id, sentence_index)
            );
            CREATE TABLE IF NOT EXISTS dictations (
                material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
                sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
                answer TEXT NOT NULL DEFAULT '',
                diff_json TEXT,
                checked_at TEXT,
                updated_at TEXT NOT NULL,
                PRIMARY KEY(material_id, sentence_id)
            );
            CREATE TABLE IF NOT EXISTS error_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                material_id TEXT NOT NULL REFERENCES materials(id) ON DELETE CASCADE,
                sentence_id INTEGER NOT NULL REFERENCES sentences(id) ON DELETE CASCADE,
                answer TEXT NOT NULL,
                expected TEXT NOT NULL,
                diff_json TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sentences_material ON sentences(material_id, sentence_index);
            CREATE INDEX IF NOT EXISTS idx_errors_material ON error_records(material_id, created_at);
            """
        )
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(materials)").fetchall()}
        if "transcript_source" not in columns:
            conn.execute("ALTER TABLE materials ADD COLUMN transcript_source TEXT NOT NULL DEFAULT 'whisper'")
        if "folder_id" not in columns:
            conn.execute("ALTER TABLE materials ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE SET NULL")
        if "completed" not in columns:
            conn.execute("ALTER TABLE materials ADD COLUMN completed INTEGER NOT NULL DEFAULT 0")
        if "completed_at" not in columns:
            conn.execute("ALTER TABLE materials ADD COLUMN completed_at TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_materials_folder ON materials(folder_id, updated_at)")


def rows(rows_: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows_]


def decode_sentence(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    item = dict(row)
    item["words"] = json.loads(item.pop("words_json") or "[]")
    if item.get("diff_json"):
        item["diff"] = json.loads(item.pop("diff_json"))
    else:
        item.pop("diff_json", None)
        item["diff"] = None
    return item
