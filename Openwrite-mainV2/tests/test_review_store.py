from pathlib import Path

from tools.review_store import ReviewStore


def test_review_store_records_rereview_issue_delta(tmp_path: Path):
    store = ReviewStore(tmp_path, "demo")
    store.save(
        "ch_001",
        {
            "score": 70,
            "issue_details": [
                {"id": "issue_keep", "dimension": "pace", "summary": "节奏拖沓"},
                {"id": "issue_fixed", "dimension": "logic", "summary": "动机缺失"},
            ],
        },
    )

    store.save(
        "ch_001",
        {
            "score": 82,
            "issue_details": [
                {"id": "issue_keep", "dimension": "pace", "summary": "节奏拖沓"},
                {"id": "issue_new", "dimension": "voice", "summary": "语气漂移"},
            ],
        },
    )

    delta = store.load("ch_001")["issue_delta"]
    assert [item["id"] for item in delta["resolved"]] == ["issue_fixed"]
    assert [item["id"] for item in delta["remaining"]] == ["issue_keep"]
    assert [item["id"] for item in delta["new"]] == ["issue_new"]
