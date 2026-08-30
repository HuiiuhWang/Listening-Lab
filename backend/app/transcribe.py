from __future__ import annotations

import math
import re
from pathlib import Path
from typing import Any

from .config import WHISPER_MODEL

END_PUNCTUATION = re.compile(r"[.!?][\"')\]]*$")
SOFT_PUNCTUATION = re.compile(r"[,;:][\"')\]]*$")


class TranscriptionError(RuntimeError):
    pass


def _word(raw: dict[str, Any], fallback_start: float, fallback_end: float) -> dict[str, Any]:
    text = str(raw.get("word", raw.get("text", "")))
    return {
        "text": text,
        "start": round(float(raw.get("start", fallback_start)), 3),
        "end": round(float(raw.get("end", fallback_end)), 3),
        "probability": raw.get("probability"),
    }


def flatten_words(result: dict[str, Any]) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for segment in result.get("segments", []):
        raw_words = segment.get("words") or []
        if raw_words:
            for raw in raw_words:
                words.append(_word(raw, float(segment["start"]), float(segment["end"])))
            continue
        # Some model/build combinations omit word timestamps. Preserve a usable fallback.
        tokens = re.findall(r"\S+", str(segment.get("text", "")))
        if not tokens:
            continue
        start, end = float(segment["start"]), float(segment["end"])
        step = (end - start) / len(tokens)
        for index, token in enumerate(tokens):
            words.append(_word({"word": (" " if index else "") + token}, start + step * index, start + step * (index + 1)))
    return words


def sentence_text(words: list[dict[str, Any]]) -> str:
    text = "".join(word["text"] for word in words).strip()
    return re.sub(r"\s+([,.;:!?])", r"\1", text)


def split_sentences(words: list[dict[str, Any]], duration: float) -> list[dict[str, Any]]:
    if not words:
        return []
    sentences: list[dict[str, Any]] = []
    current: list[dict[str, Any]] = []

    def flush() -> None:
        if not current:
            return
        sentences.append({
            "start": max(0.0, round(float(current[0]["start"]), 3)),
            "end": min(duration, round(float(current[-1]["end"]), 3)),
            "text": sentence_text(current),
            "words": [dict(word) for word in current],
        })
        current.clear()

    for index, word in enumerate(words):
        current.append(word)
        next_word = words[index + 1] if index + 1 < len(words) else None
        pause = float(next_word["start"]) - float(word["end"]) if next_word else math.inf
        elapsed = float(word["end"]) - float(current[0]["start"])
        token = str(word["text"]).strip()
        should_split = (
            bool(END_PUNCTUATION.search(token))
            or pause >= 0.8
            or elapsed >= 14.0
            or len(current) >= 28
            or (elapsed >= 7.0 and bool(SOFT_PUNCTUATION.search(token)))
            or next_word is None
        )
        if should_split:
            flush()

    # Give each sentence modest listening context without overlapping neighbors.
    for index, sentence in enumerate(sentences):
        previous_end = sentences[index - 1]["end"] if index else 0.0
        next_start = sentences[index + 1]["start"] if index + 1 < len(sentences) else duration
        sentence["start"] = round(max(previous_end, sentence["start"] - 0.08), 3)
        sentence["end"] = round(min(next_start, sentence["end"] + 0.12), 3)
    return sentences


def transcribe_audio(audio_path: Path, duration: float) -> tuple[list[dict[str, Any]], str]:
    try:
        import mlx_whisper
    except ImportError as exc:
        raise TranscriptionError(
            "mlx-whisper is not installed. On Apple Silicon, run: pip install -r backend/requirements.txt"
        ) from exc
    try:
        result = mlx_whisper.transcribe(
            str(audio_path),
            path_or_hf_repo=WHISPER_MODEL,
            language="en",
            word_timestamps=True,
            condition_on_previous_text=True,
        )
    except Exception as exc:
        raise TranscriptionError(f"Local Whisper transcription failed: {exc}") from exc
    words = flatten_words(result)
    return split_sentences(words, duration), str(result.get("text", "")).strip()
