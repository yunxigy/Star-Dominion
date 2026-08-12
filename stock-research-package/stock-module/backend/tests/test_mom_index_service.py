from datetime import UTC, datetime

import pytest

from app.integrations.mom_sources import MomCollectedPost, SourceCollection
from app.domain.mom_index import MomSourceStatus
from app.repositories.mom_index import MomIndexRepository
from app.services.mom_index import MomIndexService, MomIndexUnavailable


class StaticSource:
    def __init__(self, collection: SourceCollection) -> None:
        self.collection = collection

    def collect(self) -> SourceCollection:
        return self.collection


def collection(source_id: str, status: str, titles: list[str]) -> SourceCollection:
    now = datetime(2026, 7, 27, 0, 30, tzinfo=UTC)
    return SourceCollection(
        status=MomSourceStatus(
            source_id=source_id,
            status=status,
            collected_at=now,
            post_count=len(titles),
            message=None if status == "ok" else "需要重新登录",
        ),
        posts=[
            MomCollectedPost(
                sector_id="nasdaq",
                platform=source_id,
                platform_id=f"{source_id}-{index}",
                title=title,
                url=None,
                published_at=None,
                collected_at=now,
            )
            for index, title in enumerate(titles)
        ],
    )


def test_service_saves_partial_snapshot_when_only_eastmoney_succeeds(tmp_path) -> None:
    repository = MomIndexRepository(tmp_path / "hub.db")
    service = MomIndexService(
        repository,
        eastmoney=StaticSource(collection("eastmoney", "ok", ["小白求问纳指还能买吗"])),
        xiaohongshu=StaticSource(collection("xiaohongshu", "login_required", [])),
        clock=lambda: datetime(2026, 7, 27, 0, 30, tzinfo=UTC),
    )

    snapshot = service.refresh()

    assert snapshot.completeness == "partial"
    assert {source.status for source in snapshot.sources} == {"ok", "login_required"}
    assert repository.current() == snapshot


def test_service_keeps_history_unchanged_when_all_sources_fail(tmp_path) -> None:
    repository = MomIndexRepository(tmp_path / "hub.db")
    service = MomIndexService(
        repository,
        eastmoney=StaticSource(collection("eastmoney", "error", [])),
        xiaohongshu=StaticSource(collection("xiaohongshu", "login_required", [])),
    )

    with pytest.raises(MomIndexUnavailable):
        service.refresh()

    assert repository.current() is None


def test_service_orders_evidence_by_newest_publication_time(tmp_path) -> None:
    now = datetime(2026, 7, 27, 0, 30, tzinfo=UTC)
    posts = [
        MomCollectedPost(
            sector_id="nasdaq",
            platform="xiaohongshu",
            platform_id="older",
            title="小白怎么买",
            url=None,
            published_at=datetime(2026, 7, 27, 7, 0, tzinfo=UTC),
            collected_at=now,
        ),
        MomCollectedPost(
            sector_id="nasdaq",
            platform="xiaohongshu",
            platform_id="newer",
            title="小白怎么买",
            url=None,
            published_at=datetime(2026, 7, 27, 7, 10, tzinfo=UTC),
            collected_at=now,
        ),
    ]
    repository = MomIndexRepository(tmp_path / "hub.db")
    service = MomIndexService(
        repository,
        eastmoney=StaticSource(SourceCollection(
            status=MomSourceStatus(source_id="eastmoney", status="ok", collected_at=now, post_count=0),
            posts=[],
        )),
        xiaohongshu=StaticSource(SourceCollection(
            status=MomSourceStatus(source_id="xiaohongshu", status="ok", collected_at=now, post_count=2),
            posts=posts,
        )),
        clock=lambda: now,
    )

    snapshot = service.refresh()

    assert [post.platform_id for post in snapshot.sectors["nasdaq"].top_posts] == ["newer", "older"]


def test_service_repairs_legacy_snapshot_order_on_read(tmp_path) -> None:
    now = datetime(2026, 7, 27, 9, tzinfo=UTC)
    older_url = "https://www.xiaohongshu.com/explore/6a6701f00000000001000001?xsec_token=old"
    newer_url = "https://www.xiaohongshu.com/explore/6a6710000000000001000002?xsec_token=new"
    posts = [
        MomCollectedPost(
            sector_id="nasdaq",
            platform="xiaohongshu",
            platform_id=older_url,
            title="小白怎么买",
            url=older_url,
            published_at=None,
            collected_at=now,
        ),
        MomCollectedPost(
            sector_id="nasdaq",
            platform="xiaohongshu",
            platform_id=newer_url,
            title="小白怎么买",
            url=newer_url,
            published_at=None,
            collected_at=now,
        ),
    ]
    repository = MomIndexRepository(tmp_path / "hub.db")
    service = MomIndexService(
        repository,
        eastmoney=StaticSource(collection("eastmoney", "ok", [])),
        xiaohongshu=StaticSource(SourceCollection(
            status=MomSourceStatus(source_id="xiaohongshu", status="ok", collected_at=now, post_count=2),
            posts=posts,
        )),
        clock=lambda: now,
    )

    service.refresh()
    current = service.current()

    assert current is not None
    assert [post.platform_id for post in current.sectors["nasdaq"].top_posts] == [newer_url, older_url]
    assert current.sectors["nasdaq"].top_posts[0].published_at == datetime(2026, 7, 27, 8, tzinfo=UTC)
