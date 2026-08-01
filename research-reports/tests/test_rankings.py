from research_reports.services.rankings import (
    EntryView,
    classify_status,
    consecutive_weeks,
    hourly_delta,
    summarize,
)


def test_classify_ranking_statuses() -> None:
    history = {"a/alpha": [3], "b/beta": [1, 2]}

    assert classify_status("c/new", current_rank=1, previous_rank=None, history=history) == "new"
    assert classify_status("b/beta", current_rank=1, previous_rank=2, history=history) == "rising"
    assert classify_status("b/beta", current_rank=4, previous_rank=2, history=history) == "falling"
    assert classify_status("b/beta", current_rank=2, previous_rank=2, history=history) == "steady"
    assert classify_status("a/alpha", current_rank=5, previous_rank=None, history=history) == "returned"


def test_consecutive_weeks_stops_at_first_gap() -> None:
    assert consecutive_weeks([True, True, True, False, True]) == 3
    assert consecutive_weeks([]) == 0


def test_hourly_delta_compares_rank_and_stars() -> None:
    delta = hourly_delta(
        current_rank=2,
        current_stars=1200,
        previous_rank=5,
        previous_stars=1100,
    )
    assert delta.rank_change == 3
    assert delta.star_change == 100


def test_summary_selects_fastest_growth_with_rank_tiebreak() -> None:
    summary = summarize(
        [
            EntryView(
                full_name="a/a",
                rank=2,
                stars_since_weekly=500,
                status="rising",
                consecutive_weeks=2,
            ),
            EntryView(
                full_name="b/b",
                rank=1,
                stars_since_weekly=500,
                status="new",
                consecutive_weeks=1,
            ),
        ]
    )

    assert summary.fastest_growth_full_name == "b/b"
    assert summary.new_count == 1
    assert summary.continuing_count == 1
    assert summary.stars_since_weekly_total == 1000
