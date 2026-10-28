from pathlib import Path

import pytest
from pydantic import SecretStr

from video_downloader.config import VideoSettings


@pytest.fixture
def settings(tmp_path: Path) -> VideoSettings:
    return VideoSettings(
        environment="test",
        signing_secret=SecretStr("test-signing-secret-that-is-long-enough"),
        temp_dir=tmp_path / "video-jobs",
        cookie_secure=True,
    )
