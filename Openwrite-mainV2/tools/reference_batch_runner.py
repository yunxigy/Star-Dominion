"""Run the reference-library source analysis with provider-safe fallbacks.

The runner keeps the raw references and their V2 manifests in the normal
reference-library location.  It is intentionally a small operational wrapper:
the model key is resolved from the local model-profile store and is never
printed or written to the repository.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.model_profiles import ModelProfileStore
from tools.reference_library import (
    ReferenceLibraryService,
    default_reference_library_root,
)
from tools.source_analysis import CATEGORY_ALIASES, FOCUS_VALUES, SourceAnalysisService

DEFAULT_SOURCE_IDS = tuple(f"cankao_{index:03d}" for index in range(1, 8))
CATEGORIES = "/".join(sorted(FOCUS_VALUES))


def _bool_value(value: object, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "是"}:
            return True
        if normalized in {"false", "0", "no", "否"}:
            return False
    return default


def _locate_quote(text: str, quote: str) -> tuple[int, int] | None:
    supplied = str(quote or "")
    if not supplied:
        return None
    start = text.find(supplied)
    if start >= 0:
        return start, start + len(supplied)
    spans = SourceAnalysisService._equivalent_evidence_spans(text, supplied)
    return spans[0] if spans else None


def _valid_payload(payload: object, text: str) -> bool:
    if not isinstance(payload, dict):
        return False
    findings = payload.get("findings")
    if not isinstance(findings, list) or len(findings) < 3:
        return False
    for finding in findings:
        if not isinstance(finding, dict) or not str(finding.get("claim") or "").strip():
            return False
        evidence = finding.get("evidence")
        if isinstance(evidence, dict):
            evidence = [evidence]
        if not isinstance(evidence, list) or not evidence:
            return False
        if not any(
            isinstance(item, dict)
            and _locate_quote(text, str(item.get("quote") or "")) is not None
            for item in evidence
        ):
            return False
    return True


def _request_json(text: str, *, repair: bool) -> dict:
    profile = ModelProfileStore().resolve("source_extract")
    if repair:
        instruction = (
            "只返回JSON对象，键为summary和findings。输出至少3条结论。"
            "每条含category、claim、confidence、reusable、source_bound、evidence。"
            "evidence必须是一个对象，quote必须直接复制片段中连续不超过20字，"
            "并给出正确的0-based start/end；没有逐字证据的结论不要写。"
            f"category只用{CATEGORIES}。\n"
        )
    else:
        instruction = (
            "只返回JSON对象。键为summary和findings。findings至少3条，每条含"
            "category、claim、confidence、reusable、source_bound、evidence。"
            f"category用英文：{CATEGORIES}。"
            "evidence为一个对象，含当前片段0-based start、end、quote；"
            "quote必须逐字匹配且不超过20字。优先结构、人物、世界、节奏、线索、写法。\n"
        )
    body = {
        "model": profile["model"],
        "messages": [
            {"role": "system", "content": "你是小说拆解器，只输出JSON。"},
            {"role": "user", "content": instruction + text},
        ],
        "max_tokens": 2048,
    }
    model_name = str(profile.get("model") or "")
    if model_name.lower() == "deepseek-ai/deepseek-v4-flash":
        # Reference extraction only needs evidence-backed JSON.  V4-Flash's
        # low/medium reasoning efforts are mapped back to high by the
        # provider, so explicitly use its non-thinking mode to avoid spending
        # the account's TPM budget on hidden reasoning tokens.
        body["enable_thinking"] = False
    elif model_name == "x-preview-f-free":
        body["reasoning_effort"] = "low"
    last_error = "provider request failed"
    for attempt in range(3):
        request = Request(
            str(profile["base_url"]).rstrip("/") + "/chat/completions",
            data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
            headers={
                "Authorization": "Bearer " + str(profile["api_key"]),
                "Content-Type": "application/json",
                "User-Agent": (
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 Chrome/131.0 Safari/537.36"
                ),
                "Origin": "https://opencode.ai",
                "Referer": "https://opencode.ai/",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=180) as response:
                raw = response.read().decode("utf-8")
            response_payload = json.loads(raw)
            content = response_payload["choices"][0]["message"].get("content") or ""
            payload = SourceAnalysisService._parse_json_object(content)
            payload["model"] = profile["model"]
            return payload
        except HTTPError as exc:
            last_error = f"provider HTTP {exc.code}"
            try:
                exc.read()
            except Exception:
                pass
        except (URLError, TimeoutError, ConnectionError) as exc:
            last_error = f"provider connection failed: {type(exc).__name__}"
        except Exception as exc:
            last_error = f"model output failed: {type(exc).__name__}"
        if attempt < 2:
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(last_error)


def _repair_payload(text: str) -> dict:
    last_error = "invalid model output"
    for repair in (False, True):
        try:
            payload = _request_json(text, repair=repair)
            if _valid_payload(payload, text):
                return payload
            last_error = "model output missing verifiable evidence"
        except Exception as exc:
            last_error = str(exc) or type(exc).__name__
    raise RuntimeError(last_error)


def _normalize_findings(payload: dict, text: str, offset: int) -> list[dict]:
    normalized: list[dict] = []
    for raw in payload.get("findings", []):
        if not isinstance(raw, dict):
            continue
        item = dict(raw)
        category = str(item.get("category") or "method").strip()
        category = CATEGORY_ALIASES.get(category, category)
        item["category"] = category if category in FOCUS_VALUES else "method"
        item["reusable"] = _bool_value(item.get("reusable"), False)
        item["source_bound"] = _bool_value(item.get("source_bound"), False)
        evidence = item.get("evidence")
        if isinstance(evidence, dict):
            evidence = [evidence]
        clean_evidence: list[dict] = []
        for raw_evidence in evidence if isinstance(evidence, list) else []:
            if not isinstance(raw_evidence, dict):
                continue
            quote = str(raw_evidence.get("quote") or "")
            span = _locate_quote(text, quote)
            if span is None:
                continue
            start, end = span
            clean_evidence.append(
                {"start": start + offset, "end": end + offset, "quote": text[start:end]}
            )
        if clean_evidence:
            item["evidence"] = clean_evidence[:1]
            normalized.append(item)
    return normalized


def _split_boundary(text: str) -> int:
    middle = len(text) // 2
    for marker in ("\n\n", "\n", "。", "！", "？"):
        position = text.rfind(marker, len(text) // 3, middle + len(marker))
        if position > 0:
            return position + len(marker)
    return middle


def _collect(text: str, offset: int = 0) -> tuple[str, list[dict]]:
    try:
        payload = _repair_payload(text)
        findings = _normalize_findings(payload, text, offset)
        if len(findings) >= 3:
            return str(payload.get("summary") or "片段结构与写作要素拆解"), findings
        raise RuntimeError("verifiable findings fewer than three")
    except Exception:
        if len(text) <= 2600:
            raise
        boundary = _split_boundary(text)
        left_summary, left_findings = _collect(text[:boundary], offset)
        right_summary, right_findings = _collect(text[boundary:], offset + boundary)
        return (
            (left_summary + "；" + right_summary)[:1200],
            left_findings + right_findings,
        )


def analyzer(text: str, context: dict) -> dict:
    print("CALL", context["source_id"], context["chunk_index"], flush=True)
    summary, findings = _collect(text)
    return {
        "summary": summary[:1200],
        "model": ModelProfileStore().resolve("source_extract")["model"],
        "findings": findings[:8],
    }


def run_source(source_id: str, *, chunk_workers: int = 1) -> tuple[str, bool, str, int, int]:
    print("START", source_id, flush=True)
    result = ReferenceLibraryService(default_reference_library_root()).analyze(
        source_id, analyzer=analyzer, workers=chunk_workers
    )
    manifest = result.get("manifest", {})
    outcome = (
        source_id,
        bool(result.get("ok")),
        str(manifest.get("status")),
        int(result.get("processed_chunks", 0)),
        len(result.get("failures", [])),
    )
    print("DONE", *outcome, flush=True)
    return outcome


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--workers",
        type=int,
        default=3,
        help="单来源时的并行分析请求数；多来源时为来源并行数",
    )
    parser.add_argument("sources", nargs="*", default=list(DEFAULT_SOURCE_IDS))
    args = parser.parse_args()
    worker_count = max(1, int(args.workers))
    if len(args.sources) == 1:
        outcome = run_source(args.sources[0], chunk_workers=worker_count)
        return 0 if outcome[1] else 1
    worker_count = min(worker_count, len(args.sources))
    with ThreadPoolExecutor(max_workers=worker_count) as pool:
        futures = [
            pool.submit(run_source, source_id, chunk_workers=1)
            for source_id in args.sources
        ]
        for future in as_completed(futures):
            future.result()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
