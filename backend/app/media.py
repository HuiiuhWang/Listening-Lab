from __future__ import annotations

import json
import shutil
import subprocess
import wave
from pathlib import Path


class MediaError(RuntimeError):
    pass


def require_ffmpeg() -> None:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        raise MediaError("FFmpeg was not found. Run: brew install ffmpeg")


def extract_audio(source: Path, target: Path) -> float:
    """Extract browser-playable, seekable PCM mono audio for Whisper and playback."""
    require_ffmpeg()
    target.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg", "-y", "-i", str(source), "-vn", "-ac", "1", "-ar", "16000",
        "-c:a", "pcm_s16le", str(target),
    ]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        detail = result.stderr.strip().splitlines()[-1] if result.stderr.strip() else "unknown error"
        raise MediaError(f"FFmpeg audio extraction failed: {detail}")
    probe = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "json", str(target),
        ],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        raise MediaError("FFprobe could not read the audio duration")
    return float(json.loads(probe.stdout)["format"]["duration"])


def extract_embedded_subtitles(source: Path, target: Path) -> bool:
    """Extract the English embedded subtitle stream, or the first text stream as fallback."""
    require_ffmpeg()
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "s", "-show_streams", "-of", "json", str(source)],
        capture_output=True,
        text=True,
    )
    if probe.returncode != 0:
        return False
    streams = json.loads(probe.stdout or "{}").get("streams", [])
    if not streams:
        return False
    english = [stream for stream in streams if str(stream.get("tags", {}).get("language", "")).lower().startswith("en")]
    untagged = [stream for stream in streams if not stream.get("tags", {}).get("language")]
    for stream in english + untagged:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", str(source), "-map", f"0:{stream['index']}", str(target)],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0 and target.is_file() and target.stat().st_size > 0:
            return True
        target.unlink(missing_ok=True)
    return False


def waveform_peaks(audio_path: Path, start: float, end: float, buckets: int = 900) -> dict:
    """Read real PCM samples and return min/max values for an interactive waveform."""
    with wave.open(str(audio_path), "rb") as audio:
        rate = audio.getframerate()
        channels = audio.getnchannels()
        width = audio.getsampwidth()
        total = audio.getnframes()
        if width != 2:
            raise MediaError("Waveform processing expects FFmpeg-generated 16-bit PCM audio")
        start_frame = max(0, min(total, int(start * rate)))
        end_frame = max(start_frame + 1, min(total, int(end * rate)))
        frame_count = end_frame - start_frame
        bucket_count = max(32, min(int(buckets), 2000, frame_count))
        frames_per_bucket = max(1, frame_count // bucket_count)
        audio.setpos(start_frame)
        raw = audio.readframes(frame_count)

    # array avoids numpy as a runtime dependency. Extract channel 0 if ever non-mono.
    from array import array

    samples = array("h")
    samples.frombytes(raw)
    if channels > 1:
        samples = array("h", samples[::channels])
    values: list[list[float]] = []
    peak_abs = 1
    for offset in range(0, len(samples), frames_per_bucket):
        chunk = samples[offset : offset + frames_per_bucket]
        if not chunk:
            break
        low, high = min(chunk), max(chunk)
        peak_abs = max(peak_abs, abs(low), abs(high))
        values.append([float(low), float(high)])
    # Normalize per sentence, but keep a little headroom.
    scale = peak_abs * 1.08
    return {
        "start": start,
        "end": end,
        "duration": max(0.0, end - start),
        "sample_rate": rate,
        "peaks": [[round(low / scale, 4), round(high / scale, 4)] for low, high in values],
    }
