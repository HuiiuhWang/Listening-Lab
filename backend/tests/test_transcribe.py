from app.transcribe import split_sentences
from app.subtitles import align_cue_words, parse_subtitles


def test_split_on_punctuation_and_pause():
    words = [
        {"text": "Hello", "start": 0.1, "end": 0.4},
        {"text": " world.", "start": 0.45, "end": 0.9},
        {"text": "This", "start": 1.1, "end": 1.3},
        {"text": " works", "start": 1.35, "end": 1.7},
    ]
    result = split_sentences(words, 2.0)
    assert [item["text"] for item in result] == ["Hello world.", "This works"]
    assert result[0]["start"] == 0.02
    assert result[-1]["end"] == 1.82


def test_srt_and_word_alignment():
    content = "1\n00:00:00,500 --> 00:00:02,000\nHello, brave world!\n"
    cues = parse_subtitles(content, 4.0)
    words = align_cue_words(
        cues[0]["text"], 0.5, 2.0,
        [
            {"text": "Hello", "start": 0.55, "end": 0.9},
            {"text": " world", "start": 1.4, "end": 1.8},
        ],
    )
    assert cues[0]["text"] == "Hello, brave world!"
    assert "".join(word["text"] for word in words) == "Hello, brave world!"
    assert words[0]["start"] == 0.55
    assert words[-1]["end"] == 1.8
