from app.domain.candidates import CandidateSource, CandidateStock, merge_candidates


def test_merge_candidates_keeps_both_sources_for_same_symbol() -> None:
    catalyst = CandidateStock.create(
        symbol="600519",
        name="贵州茅台",
        source=CandidateSource(
            source_id="catalyst",
            source_name="九点猫研",
            reasons=["消费主题"],
        ),
    )
    strategy = CandidateStock.create(
        symbol="600519",
        name="贵州茅台",
        source=CandidateSource(
            source_id="user_strategy",
            source_name="用户策略",
            reasons=["2B 反转"],
        ),
    )

    merged = merge_candidates([catalyst, strategy])

    assert len(merged) == 1
    assert [item.source_id for item in merged[0].sources] == ["catalyst", "user_strategy"]


def test_merge_candidates_deduplicates_same_source() -> None:
    first = CandidateStock.create(
        symbol="002594",
        name="比亚迪",
        source=CandidateSource(
            source_id="catalyst",
            source_name="九点猫研",
            reasons=["智能驾驶"],
        ),
    )
    duplicate = CandidateStock.create(
        symbol="002594",
        name="比亚迪",
        source=CandidateSource(
            source_id="catalyst",
            source_name="九点猫研",
            reasons=["新能源汽车"],
        ),
    )

    merged = merge_candidates([first, duplicate])

    assert len(merged) == 1
    assert len(merged[0].sources) == 1

