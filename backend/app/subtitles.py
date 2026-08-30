from __future__ import annotations

import html
import re
from difflib import SequenceMatcher
from typing import Any

TIME_LINE = re.compile(
    r"(?P<start>(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>(?:\d{1,2}:)?\d{2}:\d{2}[,.]\d{3})"
)
TAG = re.compile(r"<[^>]+>")
TOKEN = re.compile(r"\s*\S+")


class SubtitleError(ValueError):
    pass


def _seconds(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    if len(parts) == 2:
        hours = 0
        minutes, seconds = parts
    else:
        hours, minutes, seconds = parts
    return int(hours) * 3600 + int(minutes) * 60 + float(seconds)


def parse_subtitles(content: str, duration: float) -> list[dict[str, Any]]:
    """Parse SRT or WebVTT cues without adding a third-party dependency."""
    normalized = content.replace("\ufeff", "").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", normalized.strip())
    cues: list[dict[str, Any]] = []
    for block in blocks:
        lines = block.splitlines()
        timing_index = next((index for index, line in enumerate(lines) if "-->" in line), None)
        if timing_index is None:
            continue
        match = TIME_LINE.search(lines[timing_index])
        if not match:
            continue
        start = max(0.0, _seconds(match.group("start")))
        end = min(duration, _seconds(match.group("end")))
        text = " ".join(line.strip() for line in lines[timing_index + 1 :] if line.strip())
        text = re.sub(r"\s+", " ", html.unescape(TAG.sub("", text))).strip()
        if text and end > start:
            cues.append({"start": round(start, 3), "end": round(end, 3), "text": text})
    if not cues:
        raise SubtitleError("No valid subtitle cues were found in this SRT/VTT file")
    return sorted(cues, key=lambda cue: (cue["start"], cue["end"]))


def _normalized_word(value: str) -> str:
    return re.sub(r"[^a-z0-9']", "", value.lower().replace("’", "'"))


def align_cue_words(text: str, start: float, end: float, whisper_words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Keep matched Whisper timestamps and interpolate only unmatched official words."""
    chunks = TOKEN.findall(text.strip())
    if not chunks:
        return []
    candidates = [
        word for word in whisper_words
        if float(word["end"]) >= start - 0.45 and float(word["start"]) <= end + 0.45
    ]
    old_tokens = [_normalized_word(str(word["text"])) for word in candidates]
    new_tokens = [_normalized_word(chunk) for chunk in chunks]
    mapped: list[dict[str, Any] | None] = [None] * len(chunks)
    matcher = SequenceMatcher(None, old_tokens, new_tokens, autojunk=False)
    for old_start, new_start, size in matcher.get_matching_blocks():
        for offset in range(size):
            source = candidates[old_start + offset]
            mapped[new_start + offset] = {
                "start": max(start, min(end, float(source["start"]))),
                "end": max(start, min(end, float(source["end"]))),
                "probability": source.get("probability"),
            }

    cursor = 0
    while cursor < len(mapped):
        if mapped[cursor] is not None:
            cursor += 1
            continue
        run_start = cursor
        while cursor < len(mapped) and mapped[cursor] is None:
            cursor += 1
        run_end = cursor
        left = float(mapped[run_start - 1]["end"]) if run_start else start  # type: ignore[index]
        right = float(mapped[run_end]["start"]) if run_end < len(mapped) else end  # type: ignore[index]
        if right <= left:
            left, right = start, end
        step = (right - left) / (run_end - run_start)
        for index in range(run_start, run_end):
            mapped[index] = {
                "start": left + step * (index - run_start),
                "end": left + step * (index - run_start + 1),
                "probability": None,
            }

    words: list[dict[str, Any]] = []
    for chunk, timing in zip(chunks, mapped):
        assert timing is not None
        words.append({
            "text": chunk,
            "start": round(float(timing["start"]), 3),
            "end": round(max(float(timing["start"]), float(timing["end"])), 3),
            "probability": timing["probability"],
        })
    return words


def official_sentences(
    cues: list[dict[str, Any]], whisper_sentences: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    all_words = [word for sentence in whisper_sentences for word in sentence["words"]]
    return [
        {
            "start": cue["start"],
            "end": cue["end"],
            "text": cue["text"],
            "words": align_cue_words(cue["text"], cue["start"], cue["end"], all_words),
        }
        for cue in cues
    ]
