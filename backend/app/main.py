from __future__ import annotations

import json
import shutil
import sqlite3
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import BackgroundTasks, FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .config import ALLOWED_EXTENSIONS, MATERIALS_DIR, MAX_UPLOAD_BYTES, ensure_data_dirs
from .db import connect, decode_sentence, init_db, now_iso
from .media import extract_audio, extract_embedded_subtitles, waveform_peaks
from .subtitles import SubtitleError, official_sentences, parse_subtitles
from .resources import practice_sources
from .transcribe import transcribe_audio


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_data_dirs()
    init_db()
    yield


app = FastAPI(title="English Listening Lab", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ProgressUpdate(BaseModel):
    current_sentence: int | None = Field(None, ge=0)
    current_position: float | None = Field(None, ge=0)
    playback_rate: float | None = Field(None, ge=0.5, le=1.25)


class SentenceUpdate(BaseModel):
    start: float = Field(ge=0)
    end: float = Field(gt=0)


class DictationUpdate(BaseModel):
    answer: str = ""
    diff: list[dict[str, Any]] | None = None
    checked: bool = False


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MaterialUpdate(BaseModel):
    folder_id: str | None = None
    completed: bool | None = None


def serialize_material(row: Any) -> dict[str, Any]:
    item = dict(row)
    item["completed"] = bool(item.get("completed", 0))
    return item


def material_or_404(material_id: str) -> dict[str, Any]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Material not found")
    return serialize_material(row)


def replace_sentences(conn: Any, material_id: str, sentences: list[dict[str, Any]], preserve_answers: bool = False) -> None:
    saved_answers = []
    if preserve_answers:
        saved_answers = conn.execute(
            """SELECT s.sentence_index, d.answer FROM sentences s
               JOIN dictations d ON d.sentence_id = s.id
               WHERE s.material_id = ? AND d.answer != ''""",
            (material_id,),
        ).fetchall()
    conn.execute("DELETE FROM sentences WHERE material_id = ?", (material_id,))
    conn.executemany(
        """INSERT INTO sentences(material_id, sentence_index, start, end, text, words_json)
           VALUES (?, ?, ?, ?, ?, ?)""",
        [
            (material_id, index, item["start"], item["end"], item["text"], json.dumps(item["words"]))
            for index, item in enumerate(sentences)
        ],
    )
    if saved_answers:
        new_ids = {
            row["sentence_index"]: row["id"]
            for row in conn.execute(
                "SELECT id, sentence_index FROM sentences WHERE material_id = ?", (material_id,)
            ).fetchall()
        }
        stamp = now_iso()
        conn.executemany(
            """INSERT INTO dictations(material_id, sentence_id, answer, updated_at)
               VALUES (?, ?, ?, ?)""",
            [
                (material_id, new_ids[row["sentence_index"]], row["answer"], stamp)
                for row in saved_answers if row["sentence_index"] in new_ids
            ],
        )


def process_material(material_id: str) -> None:
    with connect() as conn:
        row = conn.execute("SELECT * FROM materials WHERE id = ?", (material_id,)).fetchone()
    if not row:
        return
    audio_path = MATERIALS_DIR / material_id / "audio.wav"
    embedded_subtitle_path = MATERIALS_DIR / material_id / "embedded.vtt"
    try:
        duration = extract_audio(Path(row["source_path"]), audio_path)
        has_embedded_subtitles = extract_embedded_subtitles(Path(row["source_path"]), embedded_subtitle_path)
        with connect() as conn:
            conn.execute(
                "UPDATE materials SET audio_path = ?, duration = ?, status = 'transcribing', updated_at = ? WHERE id = ?",
                (str(audio_path), duration, now_iso(), material_id),
            )
        whisper_sentences, _ = transcribe_audio(audio_path, duration)
        if not whisper_sentences:
            raise RuntimeError("Whisper did not detect any English speech")
        sentences = whisper_sentences
        transcript_source = "whisper"
        if has_embedded_subtitles:
            try:
                cues = parse_subtitles(embedded_subtitle_path.read_text(encoding="utf-8-sig"), duration)
                sentences = official_sentences(cues, whisper_sentences)
                transcript_source = "official_embedded"
            except (OSError, UnicodeError, SubtitleError):
                embedded_subtitle_path.unlink(missing_ok=True)
        with connect() as conn:
            replace_sentences(conn, material_id, sentences)
            conn.execute(
                """UPDATE materials SET status = 'ready', transcript_source = ?, error = NULL,
                   current_sentence = 0, current_position = ?, updated_at = ? WHERE id = ?""",
                (transcript_source, sentences[0]["start"], now_iso(), material_id),
            )
    except Exception as exc:
        with connect() as conn:
            conn.execute(
                "UPDATE materials SET status = 'error', error = ?, updated_at = ? WHERE id = ?",
                (str(exc), now_iso(), material_id),
            )


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/practice-sources")
def get_practice_sources() -> list[dict[str, Any]]:
    return practice_sources()


@app.get("/api/materials")
def list_materials() -> list[dict[str, Any]]:
    with connect() as conn:
        result = conn.execute(
            """SELECT m.*, COUNT(s.id) AS sentence_count
               FROM materials m LEFT JOIN sentences s ON s.material_id = m.id
               GROUP BY m.id ORDER BY m.updated_at DESC"""
        ).fetchall()
    return [serialize_material(row) for row in result]


@app.get("/api/folders")
def list_folders() -> list[dict[str, Any]]:
    with connect() as conn:
        result = conn.execute(
            """SELECT f.*, COUNT(m.id) AS material_count
               FROM folders f LEFT JOIN materials m ON m.folder_id = f.id
               GROUP BY f.id ORDER BY f.name COLLATE NOCASE"""
        ).fetchall()
    return [dict(row) for row in result]


@app.post("/api/folders", status_code=201)
def create_folder(payload: FolderCreate) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Folder name cannot be empty")
    folder_id = uuid.uuid4().hex
    stamp = now_iso()
    try:
        with connect() as conn:
            conn.execute(
                "INSERT INTO folders(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
                (folder_id, name, stamp, stamp),
            )
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "A folder with this name already exists") from exc
    return {"id": folder_id, "name": name, "material_count": 0, "created_at": stamp, "updated_at": stamp}


@app.patch("/api/folders/{folder_id}")
def rename_folder(folder_id: str, payload: FolderCreate) -> dict[str, Any]:
    name = payload.name.strip()
    if not name:
        raise HTTPException(422, "Folder name cannot be empty")
    stamp = now_iso()
    try:
        with connect() as conn:
            folder = conn.execute("SELECT id FROM folders WHERE id = ?", (folder_id,)).fetchone()
            if not folder:
                raise HTTPException(404, "Folder not found")
            conn.execute("UPDATE folders SET name = ?, updated_at = ? WHERE id = ?", (name, stamp, folder_id))
            count = conn.execute("SELECT COUNT(*) AS count FROM materials WHERE folder_id = ?", (folder_id,)).fetchone()["count"]
    except sqlite3.IntegrityError as exc:
        raise HTTPException(409, "A folder with this name already exists") from exc
    return {"id": folder_id, "name": name, "material_count": count, "updated_at": stamp}


@app.delete("/api/folders/{folder_id}", status_code=204)
def delete_folder(folder_id: str, delete_materials: bool = Query(False)) -> None:
    material_ids: list[str] = []
    with connect() as conn:
        folder = conn.execute("SELECT id FROM folders WHERE id = ?", (folder_id,)).fetchone()
        if not folder:
            raise HTTPException(404, "Folder not found")
        if delete_materials:
            material_ids = [
                row["id"] for row in conn.execute("SELECT id FROM materials WHERE folder_id = ?", (folder_id,)).fetchall()
            ]
            conn.execute("DELETE FROM materials WHERE folder_id = ?", (folder_id,))
        else:
            conn.execute("UPDATE materials SET folder_id = NULL, updated_at = ? WHERE folder_id = ?", (now_iso(), folder_id))
        conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))
    for material_id in material_ids:
        material_dir = (MATERIALS_DIR / material_id).resolve()
        if material_dir.parent == MATERIALS_DIR.resolve() and material_dir.is_dir():
            shutil.rmtree(material_dir)


@app.post("/api/materials", status_code=202)
async def create_material(background_tasks: BackgroundTasks, file: UploadFile = File(...)) -> dict[str, Any]:
    filename = Path(file.filename or "media").name
    extension = Path(filename).suffix.lower()
    if extension not in ALLOWED_EXTENSIONS:
        raise HTTPException(415, f"Unsupported file type {extension or '(none)'}. Supported: {', '.join(sorted(ALLOWED_EXTENSIONS))}")
    material_id = uuid.uuid4().hex
    material_dir = MATERIALS_DIR / material_id
    material_dir.mkdir(parents=True, exist_ok=False)
    source_path = material_dir / f"source{extension}"
    size = 0
    try:
        with source_path.open("wb") as destination:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "File is too large")
                destination.write(chunk)
    except Exception:
        shutil.rmtree(material_dir, ignore_errors=True)
        raise
    finally:
        await file.close()
    stamp = now_iso()
    with connect() as conn:
        conn.execute(
            """INSERT INTO materials(id, name, original_filename, source_path, status, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'processing', ?, ?)""",
            (material_id, Path(filename).stem, filename, str(source_path), stamp, stamp),
        )
    background_tasks.add_task(process_material, material_id)
    return material_or_404(material_id)


@app.get("/api/materials/{material_id}")
def get_material(material_id: str) -> dict[str, Any]:
    material = material_or_404(material_id)
    with connect() as conn:
        sentence_rows = conn.execute(
            """SELECT s.*, d.answer, d.diff_json, d.checked_at
               FROM sentences s LEFT JOIN dictations d ON d.sentence_id = s.id
               WHERE s.material_id = ? ORDER BY s.sentence_index""",
            (material_id,),
        ).fetchall()
    material["sentences"] = [decode_sentence(row) for row in sentence_rows]
    return material


@app.patch("/api/materials/{material_id}")
def update_material(material_id: str, payload: MaterialUpdate) -> dict[str, Any]:
    material_or_404(material_id)
    updates: dict[str, Any] = {}
    if "folder_id" in payload.model_fields_set:
        if payload.folder_id is not None:
            with connect() as conn:
                folder = conn.execute("SELECT id FROM folders WHERE id = ?", (payload.folder_id,)).fetchone()
            if not folder:
                raise HTTPException(404, "Folder not found")
        updates["folder_id"] = payload.folder_id
    if payload.completed is not None:
        updates["completed"] = int(payload.completed)
        updates["completed_at"] = now_iso() if payload.completed else None
    if updates:
        updates["updated_at"] = now_iso()
        assignments = ", ".join(f"{key} = ?" for key in updates)
        with connect() as conn:
            conn.execute(f"UPDATE materials SET {assignments} WHERE id = ?", (*updates.values(), material_id))
    return material_or_404(material_id)


@app.delete("/api/materials/{material_id}", status_code=204)
def delete_material(material_id: str) -> None:
    material_or_404(material_id)
    with connect() as conn:
        conn.execute("DELETE FROM materials WHERE id = ?", (material_id,))
    material_dir = (MATERIALS_DIR / material_id).resolve()
    if material_dir.parent == MATERIALS_DIR.resolve() and material_dir.is_dir():
        shutil.rmtree(material_dir)


@app.get("/api/materials/{material_id}/audio")
def get_audio(material_id: str) -> FileResponse:
    material = material_or_404(material_id)
    path = Path(material["audio_path"] or "")
    if material["status"] not in {"transcribing", "ready"} or not path.is_file():
        raise HTTPException(409, "Audio is not ready yet")
    return FileResponse(path, media_type="audio/wav", filename=f"{material['name']}.wav")


@app.post("/api/materials/{material_id}/subtitles")
async def import_subtitles(material_id: str, file: UploadFile = File(...)) -> dict[str, Any]:
    material = material_or_404(material_id)
    if material["status"] != "ready":
        raise HTTPException(409, "Wait for transcription to finish before importing subtitles")
    filename = Path(file.filename or "subtitles").name
    extension = Path(filename).suffix.lower()
    if extension not in {".srt", ".vtt"}:
        raise HTTPException(415, "Official subtitles must be an SRT or VTT file")
    content = await file.read(5 * 1024 * 1024 + 1)
    await file.close()
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(413, "Subtitle file is too large")
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    try:
        cues = parse_subtitles(text, float(material["duration"]))
    except SubtitleError as exc:
        raise HTTPException(422, str(exc)) from exc

    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM sentences WHERE material_id = ? ORDER BY sentence_index", (material_id,)
        ).fetchall()
        current_sentences = [
            {**dict(row), "words": json.loads(row["words_json"] or "[]")}
            for row in rows
        ]
        sentences = official_sentences(cues, current_sentences)
        replace_sentences(conn, material_id, sentences, preserve_answers=True)
        conn.execute(
            """UPDATE materials SET transcript_source = 'official_import', current_sentence = 0,
               current_position = ?, updated_at = ? WHERE id = ?""",
            (sentences[0]["start"], now_iso(), material_id),
        )
    target = MATERIALS_DIR / material_id / f"official{extension}"
    target.write_bytes(content)
    return get_material(material_id)


@app.get("/api/materials/{material_id}/waveform")
def get_waveform(
    material_id: str,
    start: float = Query(ge=0),
    end: float = Query(gt=0),
    buckets: int = Query(900, ge=64, le=2000),
) -> dict[str, Any]:
    material = material_or_404(material_id)
    if end <= start or end > float(material["duration"]) + 0.1:
        raise HTTPException(422, "Invalid waveform time range")
    path = Path(material["audio_path"] or "")
    if not path.is_file():
        raise HTTPException(409, "Audio is not ready yet")
    return waveform_peaks(path, start, min(end, float(material["duration"])), buckets)


@app.patch("/api/materials/{material_id}/progress")
def update_progress(material_id: str, payload: ProgressUpdate) -> dict[str, Any]:
    material = material_or_404(material_id)
    updates = payload.model_dump(exclude_none=True)
    if not updates:
        return material
    updates["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in updates)
    with connect() as conn:
        conn.execute(
            f"UPDATE materials SET {assignments} WHERE id = ?",
            (*updates.values(), material_id),
        )
    return material_or_404(material_id)


@app.patch("/api/materials/{material_id}/sentences/{sentence_id}")
def update_sentence(material_id: str, sentence_id: int, payload: SentenceUpdate) -> dict[str, Any]:
    material = material_or_404(material_id)
    if payload.end <= payload.start:
        raise HTTPException(422, "End time must be later than start time")
    if payload.end > float(material["duration"]) + 0.001:
        raise HTTPException(422, "End time exceeds the audio duration")
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM sentences WHERE id = ? AND material_id = ?", (sentence_id, material_id)
        ).fetchone()
        if not row:
            raise HTTPException(404, "Sentence not found")
        conn.execute(
            "UPDATE sentences SET start = ?, end = ? WHERE id = ?",
            (payload.start, payload.end, sentence_id),
        )
        updated = conn.execute(
            """SELECT s.*, d.answer, d.diff_json, d.checked_at
               FROM sentences s LEFT JOIN dictations d ON d.sentence_id = s.id WHERE s.id = ?""",
            (sentence_id,),
        ).fetchone()
    return decode_sentence(updated)


@app.put("/api/materials/{material_id}/sentences/{sentence_id}/dictation")
def save_dictation(material_id: str, sentence_id: int, payload: DictationUpdate) -> dict[str, bool]:
    with connect() as conn:
        sentence = conn.execute(
            "SELECT * FROM sentences WHERE id = ? AND material_id = ?", (sentence_id, material_id)
        ).fetchone()
        if not sentence:
            raise HTTPException(404, "Sentence not found")
        stamp = now_iso()
        diff_json = json.dumps(payload.diff) if payload.diff is not None else None
        conn.execute(
            """INSERT INTO dictations(material_id, sentence_id, answer, diff_json, checked_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)
               ON CONFLICT(material_id, sentence_id) DO UPDATE SET
                 answer = excluded.answer,
                 diff_json = excluded.diff_json,
                 checked_at = excluded.checked_at,
                 updated_at = excluded.updated_at""",
            (material_id, sentence_id, payload.answer, diff_json, stamp if payload.checked else None, stamp),
        )
        if payload.checked and payload.diff and any(item.get("type") != "equal" for item in payload.diff):
            conn.execute(
                """INSERT INTO error_records(material_id, sentence_id, answer, expected, diff_json, created_at)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (material_id, sentence_id, payload.answer, sentence["text"], diff_json, stamp),
            )
    return {"saved": True}
