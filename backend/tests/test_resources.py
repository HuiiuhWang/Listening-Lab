from app.resources import parse_feed


def test_parse_rss_episode():
    xml = b"""<?xml version="1.0"?><rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"><channel><item>
      <title>Natural English</title><link>https://example.com/episode</link>
      <description><![CDATA[<p>A useful episode.</p>]]></description><pubDate>Sun, 30 Aug 2026 09:00:00 GMT</pubDate>
      <itunes:duration>12:34</itunes:duration><enclosure url="https://example.com/audio.mp3" type="audio/mpeg" />
    </item></channel></rss>"""
    result = parse_feed(xml, "test")
    assert result[0]["title"] == "Natural English"
    assert result[0]["duration_seconds"] == 754
    assert result[0]["description"] == "A useful episode."
