from __future__ import annotations

from video_downloader.format_policy import FormatPolicy


def test_groups_formats_and_pairs_video_only_with_audio(settings):
    formats = [
        {
            "format_id": "p720",
            "height": 720,
            "ext": "mp4",
            "vcodec": "avc1.64001f",
            "acodec": "mp4a.40.2",
            "filesize": 20_000_000,
            "tbr": 1800,
        },
        {
            "format_id": "v1080",
            "height": 1080,
            "ext": "mp4",
            "vcodec": "avc1.640028",
            "acodec": "none",
            "filesize": 40_000_000,
            "tbr": 3000,
        },
        {
            "format_id": "a1",
            "height": None,
            "ext": "m4a",
            "vcodec": "none",
            "acodec": "mp4a.40.2",
            "filesize": 4_000_000,
            "abr": 128,
        },
    ]

    selections = FormatPolicy(settings.max_file_bytes).build("bilibili", formats)

    assert [item.public.label for item in selections] == ["1080P", "720P"]
    assert selections[0].public.requires_merge is True
    assert selections[0].public.has_audio is True
    assert selections[0].public.estimated_bytes == 44_000_000
    assert selections[0].selector == "v1080+a1"
    assert selections[0].public.id.startswith("q_")
    assert "v1080" not in selections[0].public.id
    assert selections[1].public.requires_merge is False


def test_discards_oversize_formats(settings):
    policy = FormatPolicy(max_file_bytes=100)
    formats = [
        {
            "format_id": "large",
            "height": 720,
            "ext": "mp4",
            "vcodec": "h264",
            "acodec": "aac",
            "filesize": 101,
        }
    ]

    assert policy.build("douyin", formats) == []


def test_prefers_mp4_h264_progressive_for_the_same_height(settings):
    formats = [
        {
            "format_id": "vp9",
            "height": 720,
            "ext": "webm",
            "vcodec": "vp9",
            "acodec": "opus",
            "tbr": 3000,
        },
        {
            "format_id": "h264",
            "height": 720,
            "ext": "mp4",
            "vcodec": "avc1.64001f",
            "acodec": "mp4a.40.2",
            "tbr": 1500,
        },
    ]

    selection = FormatPolicy(settings.max_file_bytes).build("douyin", formats)[0]

    assert selection.selector == "h264"
    assert selection.public.extension == "mp4"
    assert selection.public.requires_merge is False


def test_reports_unknown_size_and_missing_audio(settings):
    formats = [
        {
            "format_id": "video-only",
            "height": 480,
            "ext": "mp4",
            "vcodec": "h264",
            "acodec": "none",
        }
    ]

    selection = FormatPolicy(settings.max_file_bytes).build("douyin", formats)[0]

    assert selection.public.estimated_bytes is None
    assert selection.public.has_audio is False
    assert selection.public.requires_merge is False


def test_quality_ids_are_stable_but_do_not_collide(settings):
    policy = FormatPolicy(settings.max_file_bytes)
    first = [{"format_id": "one", "height": 360, "ext": "mp4", "vcodec": "h264", "acodec": "aac"}]
    second = [{"format_id": "two", "height": 360, "ext": "mp4", "vcodec": "h264", "acodec": "aac"}]

    first_id = policy.build("douyin", first)[0].public.id

    assert policy.build("douyin", first)[0].public.id == first_id
    assert policy.build("douyin", second)[0].public.id != first_id


def test_deduplicates_duplicate_format_ids(settings):
    duplicate = {
        "format_id": "same",
        "height": 720,
        "ext": "mp4",
        "vcodec": "h264",
        "acodec": "aac",
    }

    selections = FormatPolicy(settings.max_file_bytes).build("douyin", [duplicate, duplicate.copy()])

    assert len(selections) == 1
