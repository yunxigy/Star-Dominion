from __future__ import annotations

import threading
from pathlib import Path

import pytest
from yt_dlp.utils import DownloadError

from video_downloader.errors import ServiceError
from video_downloader.extractor import DownloadCancelled, DownloadSpec, YtDlpExtractor
from video_downloader.format_policy import FormatSelection
from video_downloader.models import QualityOption
from video_downloader.url_policy import ResolvedVideoUrl


class FakeYdl:
    def __init__(self, options, result=None, error: Exception | None = None):
        self.options = options
        self.result = result
        self.error = error

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def extract_info(self, url, download):
        assert download is False
        if self.error is not None:
            raise self.error
        return self.result


def bilibili_result(**overrides):
    result = {
        "extractor_key": "BiliBili",
        "webpage_url": "https://www.bilibili.com/video/BV1demo",
        "id": "BV1demo",
        "title": "演示视频",
        "uploader": "作者",
        "thumbnail": "https://i0.hdslb.com/demo.jpg",
        "duration": 120,
        "formats": [
            {
                "format_id": "p720",
                "height": 720,
                "ext": "mp4",
                "vcodec": "h264",
                "acodec": "aac",
                "filesize": 1000,
            }
        ],
    }
    result.update(overrides)
    return result


def test_extracts_single_bilibili_video_with_server_format_map(settings):
    result = bilibili_result()
    captured = {}

    def factory(options):
        captured.update(options)
        return FakeYdl(options, result)

    extractor = YtDlpExtractor(settings, ydl_factory=factory)
    extracted = extractor.extract(ResolvedVideoUrl("bilibili", result["webpage_url"]))

    assert captured["noplaylist"] is True
    assert captured["allowed_extractors"] == ["Douyin", "BiliBili"]
    assert "Generic" not in captured["allowed_extractors"]
    assert "cookiefile" not in captured
    assert extracted.video.platform == "bilibili"
    assert extracted.video.id == "BV1demo"
    assert extracted.video.title == "演示视频"
    assert extracted.video.author == "作者"
    assert extracted.video.duration_seconds == 120
    assert list(extracted.format_map) == [extracted.video.qualities[0].id]


@pytest.mark.parametrize("entries", [[{"id": "1"}, {"id": "2"}], []])
def test_rejects_playlist_or_empty_entries(settings, entries):
    result = bilibili_result(_type="playlist", entries=entries)
    extractor = YtDlpExtractor(settings, ydl_factory=lambda options: FakeYdl(options, result))

    with pytest.raises(ServiceError) as caught:
        extractor.extract(ResolvedVideoUrl("bilibili", "https://www.bilibili.com/video/BV1"))

    assert caught.value.code == "PLAYLIST_NOT_SUPPORTED"


def test_rejects_video_over_duration_limit(settings):
    result = bilibili_result(duration=settings.max_duration_seconds + 1)
    extractor = YtDlpExtractor(settings, ydl_factory=lambda options: FakeYdl(options, result))

    with pytest.raises(ServiceError) as caught:
        extractor.extract(ResolvedVideoUrl("bilibili", result["webpage_url"]))

    assert caught.value.code == "DURATION_LIMIT"
    assert caught.value.http_status == 413


def test_rejects_video_when_all_formats_exceed_size_limit(settings):
    result = bilibili_result(
        formats=[
            {
                "format_id": "large",
                "height": 720,
                "ext": "mp4",
                "vcodec": "h264",
                "acodec": "aac",
                "filesize": settings.max_file_bytes + 1,
            }
        ]
    )
    extractor = YtDlpExtractor(settings, ydl_factory=lambda options: FakeYdl(options, result))

    with pytest.raises(ServiceError) as caught:
        extractor.extract(ResolvedVideoUrl("bilibili", result["webpage_url"]))

    assert caught.value.code == "FILE_SIZE_LIMIT"


@pytest.mark.parametrize(
    "result",
    [
        bilibili_result(extractor_key="Douyin"),
        bilibili_result(webpage_url="https://example.org/video/1"),
    ],
)
def test_rejects_extractor_or_webpage_platform_mismatch(settings, result):
    extractor = YtDlpExtractor(settings, ydl_factory=lambda options: FakeYdl(options, result))

    with pytest.raises(ServiceError) as caught:
        extractor.extract(ResolvedVideoUrl("bilibili", "https://www.bilibili.com/video/BV1demo"))

    assert caught.value.code == "INVALID_URL"


def test_uses_admin_cookie_only_for_douyin(settings, tmp_path: Path):
    cookie_file = tmp_path / "cookies.txt"
    cookie_file.write_text("# Netscape HTTP Cookie File\n.example\tTRUE\t/\tTRUE\t0\ta\tb\n", encoding="utf-8")
    configured = settings.model_copy(update={"douyin_cookie_file": cookie_file})
    captured = {}
    result = bilibili_result(
        extractor_key="Douyin",
        webpage_url="https://www.douyin.com/video/123",
        id="123",
    )

    def factory(options):
        captured.update(options)
        return FakeYdl(options, result)

    extractor = YtDlpExtractor(configured, ydl_factory=factory)
    extractor.extract(ResolvedVideoUrl("douyin", result["webpage_url"]))

    assert captured["cookiefile"] == str(cookie_file)


def test_drops_non_https_thumbnail(settings):
    result = bilibili_result(thumbnail="javascript:alert(1)")
    extractor = YtDlpExtractor(settings, ydl_factory=lambda options: FakeYdl(options, result))

    extracted = extractor.extract(ResolvedVideoUrl("bilibili", result["webpage_url"]))

    assert extracted.video.thumbnail_url is None


@pytest.mark.parametrize(
    ("message", "platform", "code", "status"),
    [
        ("Private video. Sign in if you've been granted access", "bilibili", "PRIVATE_OR_UNAVAILABLE", 422),
        ("Fresh cookies are needed to access this Douyin video", "douyin", "COOKIE_REQUIRED", 503),
        ("Unable to download webpage: timed out", "bilibili", "EXTRACTOR_TEMPORARILY_UNAVAILABLE", 502),
    ],
)
def test_maps_yt_dlp_failures_to_stable_errors(settings, message, platform, code, status):
    target_url = "https://www.douyin.com/video/1" if platform == "douyin" else "https://www.bilibili.com/video/BV1"
    extractor = YtDlpExtractor(
        settings,
        ydl_factory=lambda options: FakeYdl(options, error=DownloadError(message)),
    )

    with pytest.raises(ServiceError) as caught:
        extractor.extract(ResolvedVideoUrl(platform, target_url))

    assert caught.value.code == code
    assert caught.value.http_status == status


class RecordingHooks:
    def __init__(self) -> None:
        self.stages: list[str] = []
        self.download_updates: list[tuple[int, int | None, float | None]] = []

    def extracting(self) -> None:
        self.stages.append("extracting")

    def downloading(self, downloaded_bytes, total_bytes, speed_bytes_per_second) -> None:
        self.stages.append("downloading")
        self.download_updates.append((downloaded_bytes, total_bytes, speed_bytes_per_second))

    def merging(self) -> None:
        self.stages.append("merging")

    def completed(self, output_path) -> None:
        self.stages.append("completed")


def download_spec(tmp_path: Path, *, requires_merge: bool = False) -> DownloadSpec:
    quality = QualityOption(
        id="q_12345678",
        label="1080P" if requires_merge else "720P",
        height=1080 if requires_merge else 720,
        extension="mp4",
        estimated_bytes=100,
        requires_merge=requires_merge,
        has_audio=True,
    )
    return DownloadSpec(
        target=ResolvedVideoUrl("bilibili", "https://www.bilibili.com/video/BV1demo"),
        video_id="BV1demo",
        title="演示/视频",
        selection=FormatSelection(
            public=quality,
            selector="v1080+a1" if requires_merge else "p720",
            merge_extension="mp4" if requires_merge else None,
        ),
        directory=tmp_path,
        cancel_event=threading.Event(),
    )


class FakeDownloadYdl(FakeYdl):
    def extract_info(self, url, download):
        assert download is True
        for hook in self.options["progress_hooks"]:
            hook({"status": "downloading", "downloaded_bytes": 50, "total_bytes": 100, "speed": 12.5})
        for hook in self.options["postprocessor_hooks"]:
            hook({"status": "started", "postprocessor": "FFmpegMerger"})
            hook({"status": "finished", "postprocessor": "FFmpegMerger"})
        output = Path(self.options["outtmpl"].replace("%(ext)s", "mp4"))
        output.write_bytes(b"video")
        return {"requested_downloads": [{"filepath": str(output)}]}


class FailingDownloadYdl(FakeYdl):
    def extract_info(self, url, download):
        assert download is True
        raise self.error


def test_download_uses_server_selector_and_safe_output_name(settings, tmp_path: Path):
    captured = {}

    def factory(options):
        captured.update(options)
        return FakeDownloadYdl(options)

    extractor = YtDlpExtractor(settings, ydl_factory=factory, ffmpeg_available=lambda: True)
    spec = download_spec(tmp_path, requires_merge=True)
    hooks = RecordingHooks()

    output = extractor.download(spec, hooks)

    assert captured["format"] == "v1080+a1"
    assert captured["outtmpl"] == str(tmp_path / "media.%(ext)s")
    assert captured["merge_output_format"] == "mp4"
    assert output.name == "演示_视频-bilibili-BV1demo.mp4"
    assert output.read_bytes() == b"video"
    assert hooks.download_updates == [(50, 100, 12.5)]
    assert "merging" in hooks.stages
    assert hooks.stages[-1] == "completed"


def test_download_checks_cancel_event_before_start(settings, tmp_path: Path):
    spec = download_spec(tmp_path)
    spec.cancel_event.set()
    extractor = YtDlpExtractor(settings, ydl_factory=lambda options: FakeDownloadYdl(options))

    with pytest.raises(DownloadCancelled):
        extractor.download(spec, RecordingHooks())


def test_download_progress_aborts_when_actual_bytes_exceed_limit(settings, tmp_path: Path):
    configured = settings.model_copy(update={"max_file_bytes": 10})
    extractor = YtDlpExtractor(configured, ydl_factory=lambda options: FakeDownloadYdl(options))

    with pytest.raises(ServiceError) as caught:
        extractor.download(download_spec(tmp_path), RecordingHooks())

    assert caught.value.code == "FILE_SIZE_LIMIT"


def test_merge_quality_requires_ffmpeg(settings, tmp_path: Path):
    extractor = YtDlpExtractor(
        settings,
        ydl_factory=lambda options: FakeDownloadYdl(options),
        ffmpeg_available=lambda: False,
    )

    with pytest.raises(ServiceError) as caught:
        extractor.download(download_spec(tmp_path, requires_merge=True), RecordingHooks())

    assert caught.value.code == "DEPENDENCY_UNAVAILABLE"


def test_ffmpeg_download_error_maps_to_merge_failed(settings, tmp_path: Path):
    extractor = YtDlpExtractor(
        settings,
        ydl_factory=lambda options: FailingDownloadYdl(
            options,
            error=DownloadError("Postprocessing: ffmpeg merger failed"),
        ),
        ffmpeg_available=lambda: True,
    )

    with pytest.raises(ServiceError) as caught:
        extractor.download(download_spec(tmp_path, requires_merge=True), RecordingHooks())

    assert caught.value.code == "MERGE_FAILED"
