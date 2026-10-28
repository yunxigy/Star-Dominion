from __future__ import annotations

from pathlib import Path

import pytest

from video_downloader.files import JobFiles, safe_download_name


@pytest.mark.parametrize(
    ("title", "expected"),
    [
        ("普通标题", "普通标题-bilibili-BV1.mp4"),
        ("../CON:<测试>?", "CON_测试-bilibili-BV1.mp4"),
        ("   ", "video-bilibili-BV1.mp4"),
        ("CON", "_CON-bilibili-BV1.mp4"),
    ],
)
def test_safe_download_name(title, expected):
    assert safe_download_name(title, "bilibili", "BV1", "mp4") == expected


def test_safe_download_name_removes_controls_and_limits_title():
    filename = safe_download_name("a\x00b" + "长" * 200, "douyin", "123", "MP4")

    assert "\x00" not in filename
    assert filename.endswith("-douyin-123.mp4")
    assert len(filename.split("-douyin-", 1)[0]) <= 120


def test_cleanup_only_accepts_uuid_child_directory(tmp_path: Path):
    files = JobFiles(tmp_path / "jobs")
    files.ensure_root()
    outside = tmp_path / "outside"
    outside.mkdir()

    with pytest.raises(ValueError):
        files.cleanup(outside)

    assert outside.exists()


def test_creates_and_cleans_uuid_job_directory(tmp_path: Path):
    files = JobFiles(tmp_path / "jobs")
    files.ensure_root()
    job_id, directory = files.create_job_directory()
    (directory / "part.tmp").write_bytes(b"data")

    assert directory.name == job_id
    files.cleanup(directory)

    assert not directory.exists()


def test_startup_cleanup_removes_only_uuid_directories(tmp_path: Path):
    files = JobFiles(tmp_path / "jobs")
    files.ensure_root()
    _job_id, directory = files.create_job_directory()
    keep_directory = files.root / "manual"
    keep_directory.mkdir()
    keep_file = files.root / "README.keep"
    keep_file.write_text("keep", encoding="utf-8")

    removed = files.cleanup_orphans()

    assert removed == 1
    assert not directory.exists()
    assert keep_directory.exists()
    assert keep_file.exists()
