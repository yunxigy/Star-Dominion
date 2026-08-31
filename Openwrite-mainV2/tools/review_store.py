"""Persistent structured chapter review results."""

from __future__ import annotations

import hashlib
import json
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def normalize_review_issues(chapter_id: str, issues: Any) -> list[dict[str, Any]]:
    """Add stable revision-oriented fields while preserving legacy issue data."""
    if not isinstance(issues, list):
        return []
    normalized: list[dict[str, Any]] = []
    severity_map = {
        "critical": "blocker",
        "blocker": "blocker",
        "error": "high",
        "high": "high",
        "warning": "medium",
        "medium": "medium",
        "info": "low",
        "low": "low",
    }
    for index, raw in enumerate(issues):
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        summary = str(item.get("summary") or item.get("description") or "").strip()
        dimension = str(item.get("dimension") or item.get("category") or "general")
        digest_source = f"{chapter_id}\0{dimension}\0{summary}\0{index}"
        issue_id = str(item.get("id") or "").strip() or (
            "issue_" + hashlib.sha256(digest_source.encode("utf-8")).hexdigest()[:12]
        )
        evidence = item.get("evidence") if isinstance(item.get("evidence"), dict) else {}
        anchor = item.get("anchor") if isinstance(item.get("anchor"), dict) else {}
        quote = str(evidence.get("quote") or item.get("quote") or "")
        normalized.append(
            {
                **item,
                "id": issue_id,
                "dimension": dimension,
                "severity": severity_map.get(str(item.get("severity") or "").lower(), "medium"),
                "legacy_severity": str(item.get("severity") or "warning"),
                "summary": summary,
                "evidence": {
                    "quote": quote,
                    "context_before": str(evidence.get("context_before") or ""),
                    "context_after": str(evidence.get("context_after") or ""),
                },
                "anchor": {
                    "start_hint": anchor.get("start_hint"),
                    "end_hint": anchor.get("end_hint"),
                },
                "suggestion": str(item.get("suggestion") or ""),
                "auto_fixable": bool(item.get("auto_fixable", bool(quote or anchor))),
            }
        )
    return normalized


class ReviewStore:
    def __init__(self, project_root: Path, novel_id: str):
        self.project_root = Path(project_root).resolve()
        self.novel_id = novel_id
        self.review_dir = (
            self.project_root
            / "data"
            / "novels"
            / novel_id
            / "data"
            / "reviews"
        )

    def save(self, chapter_id: str, result: dict[str, Any]) -> Path:
        self.review_dir.mkdir(parents=True, exist_ok=True)
        previous = self.load(chapter_id)
        payload = dict(result)
        payload["issue_details"] = normalize_review_issues(
            chapter_id, payload.get("issue_details", [])
        )
        if previous is not None:
            before = normalize_review_issues(
                chapter_id,
                previous.get("issue_details", []),
            )
            before_by_id = {str(item["id"]): item for item in before}
            after_by_id = {
                str(item["id"]): item for item in payload["issue_details"]
            }
            payload["issue_delta"] = {
                "resolved": [
                    item for issue_id, item in before_by_id.items() if issue_id not in after_by_id
                ],
                "remaining": [
                    item for issue_id, item in after_by_id.items() if issue_id in before_by_id
                ],
                "new": [
                    item for issue_id, item in after_by_id.items() if issue_id not in before_by_id
                ],
            }
        payload.setdefault("source_revision", self._source_revision(chapter_id))
        payload["reviewed_at"] = datetime.now(timezone.utc).isoformat()
        target = self.path_for(chapter_id)
        with tempfile.NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=self.review_dir,
            prefix=f".{chapter_id}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            temp_path = Path(handle.name)
        temp_path.replace(target)
        return target

    def _source_revision(self, chapter_id: str) -> str:
        manuscript = (
            self.project_root
            / "data"
            / "novels"
            / self.novel_id
            / "data"
            / "manuscript"
        )
        matches = list(manuscript.glob(f"**/{chapter_id}.md"))
        if len(matches) != 1:
            return ""
        try:
            content = matches[0].read_text(encoding="utf-8")
        except OSError:
            return ""
        return "sha256:" + hashlib.sha256(content.encode("utf-8")).hexdigest()

    def load(self, chapter_id: str) -> dict[str, Any] | None:
        path = self.path_for(chapter_id)
        if not path.is_file():
            return None
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        return data if isinstance(data, dict) else None

    def path_for(self, chapter_id: str) -> Path:
        if not chapter_id.startswith("ch_") or not chapter_id[3:].isdigit():
            raise ValueError(f"无效章节 ID: {chapter_id}")
        return self.review_dir / f"{chapter_id}.json"

    def analytics(self) -> dict[str, int | float]:
        scores: list[float] = []
        passed = 0
        if self.review_dir.exists():
            for path in self.review_dir.glob("ch_*.json"):
                record = self.load(path.stem)
                if not record:
                    continue
                try:
                    scores.append(float(record.get("score") or 0))
                except (TypeError, ValueError):
                    continue
                passed += int(bool(record.get("passed")))
        return {
            "reviewed_chapters": len(scores),
            "passed_chapters": passed,
            "average_score": round(sum(scores) / len(scores), 1) if scores else 0.0,
        }
