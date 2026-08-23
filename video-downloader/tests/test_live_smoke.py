import os

import pytest

from video_downloader.config import VideoSettings
from video_downloader.extractor import YtDlpExtractor
from video_downloader.url_policy import UrlPolicy


@pytest.mark.live
@pytest.mark.parametrize(
    ("env_name", "platform"),
    [
        ("VIDEO_LIVE_DOUYIN_URL", "douyin"),
        ("VIDEO_LIVE_BILIBILI_URL", "bilibili"),
    ],
)
def test_authorized_public_video_can_be_parsed(env_name, platform):
    url = os.getenv(env_name)
    if not url:
        pytest.skip(f"{env_name} is not configured")
    settings = VideoSettings()
    target = UrlPolicy.from_settings(settings).resolve(url)
    result = YtDlpExtractor(settings).extract(target)
    assert result.video.platform == platform
    assert result.video.qualities
