from __future__ import annotations

import html
import re
import threading
import time
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from typing import Any

SOURCES = [
    {
        "id": "bbc-global-news",
        "name": "BBC Global News Podcast",
        "provider": "BBC World Service",
        "level": "C1–C2",
        "accent": "British + international",
        "description": "Fast current-affairs reporting, correspondent clips, interviews, and varied accents.",
        "site_url": "https://www.bbc.co.uk/programmes/p02nq0gn",
        "feed_url": "https://podcasts.files.bbci.co.uk/p02nq0gn.rss",
    },
    {
        "id": "voa-international-edition",
        "name": "VOA International Edition",
        "provider": "Voice of America",
        "level": "B2–C1",
        "accent": "American + international",
        "description": "VOA's regular-speed global news podcast with reports, eyewitness accounts, and analysis.",
        "site_url": "https://www.voanews.com/z/7104",
        "feed_url": "https://www.voanews.com/podcast/?zoneId=7104",
    },
    {
        "id": "bbc-in-our-time",
        "name": "BBC In Our Time",
        "provider": "BBC Radio 4",
        "level": "C1–C2",
        "accent": "British academic discussion",
        "description": "Dense expert discussions on history, science, philosophy, religion, and culture.",
        "site_url": "https://www.bbc.co.uk/programmes/b006qykl",
        "feed_url": "https://podcasts.files.bbci.co.uk/b006qykl.rss",
    },
    {
        "id": "npr-up-first",
        "name": "NPR Up First",
        "provider": "NPR",
        "level": "B2–C1",
        "accent": "Natural American",
        "description": "Compact daily US and world news with natural delivery and frequent interview clips.",
        "site_url": "https://www.npr.org/podcasts/510318/up-first",
        "feed_url": "https://feeds.npr.org/510318/podcast.xml",
    },
    {
        "id": "ted-talks",
        "name": "TED Talks",
        "provider": "TED",
        "level": "B2–C2",
        "accent": "International",
        "description": "Topic-rich talks with official video subtitles and transcripts; choose technical topics for higher difficulty.",
        "site_url": "https://www.ted.com/talks",
        "feed_url": None,
    },
]

TAG = re.compile(r"<[^>]+>")
SPACE = re.compile(r"\s+")
_cache: tuple[float, list[dict[str, Any]]] | None = None
_cache_lock = threading.Lock()


def _text(element: ET.Element, name: str) -> str:
    child = element.find(name)
    return child.text.strip() if child is not None and child.text else ""


def _duration(value: str) -> int | None:
    if not value:
        return None
    try:
        parts = [int(part) for part in value.strip().split(":")]
    except ValueError:
        return None
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return parts[0] * 60 + parts[1]
    return parts[-3] * 3600 + parts[-2] * 60 + parts[-1]


def parse_feed(xml: bytes, source_id: str, limit: int = 6) -> list[dict[str, Any]]:
    root = ET.fromstring(xml)
    episodes: list[dict[str, Any]] = []
    for item in root.findall("./channel/item")[:limit]:
        enclosure = item.find("enclosure")
        audio_url = enclosure.attrib.get("url", "") if enclosure is not None else ""
        audio_url = html.unescape(audio_url).replace("http://", "https://", 1)
        description = _text(item, "description")
        description = SPACE.sub(" ", html.unescape(TAG.sub("", description))).strip()
        duration = ""
        for child in item:
            if child.tag.endswith("duration") and child.text:
                duration = child.text
                break
        page_url = _text(item, "link").replace("http://", "https://", 1)
        episodes.append({
            "source_id": source_id,
            "title": _text(item, "title"),
            "description": description[:360],
            "published": _text(item, "pubDate"),
            "duration_seconds": _duration(duration),
            "page_url": page_url,
            "audio_url": audio_url,
        })
    return episodes


def _load_source(source: dict[str, Any]) -> dict[str, Any]:
    item = {key: value for key, value in source.items() if key != "feed_url"}
    item["episodes"] = []
    item["available"] = True
    if not source["feed_url"]:
        return item
    try:
        request = urllib.request.Request(
            source["feed_url"],
            headers={"User-Agent": "ListeningLab/0.1 (+local personal study app)"},
        )
        with urllib.request.urlopen(request, timeout=12) as response:
            xml = response.read(5 * 1024 * 1024)
        item["episodes"] = parse_feed(xml, source["id"])
    except Exception:
        # A source page remains useful even when its feed is temporarily unavailable.
        item["available"] = False
    return item


def practice_sources() -> list[dict[str, Any]]:
    global _cache
    now = time.monotonic()
    with _cache_lock:
        if _cache and now - _cache[0] < 15 * 60:
            return _cache[1]
    with ThreadPoolExecutor(max_workers=4) as pool:
        result = list(pool.map(_load_source, SOURCES))
    with _cache_lock:
        _cache = (now, result)
    return result
