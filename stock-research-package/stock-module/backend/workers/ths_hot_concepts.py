"""Collect and rank hot stock concepts published by Tonghuashun."""

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from io import StringIO
import json
import math
import os
from pathlib import Path
import re
from typing import Any

from bs4 import BeautifulSoup
import pandas as pd
import requests


FUND_FLOW_URL = (
    "http://data.10jqka.com.cn/funds/gnzjl/"
    "field/tradezdf/order/desc/page/1/ajax/1/free/1/"
)
FUND_FLOW_REFERER = "http://data.10jqka.com.cn/funds/gnzjl/"
CONCEPT_DETAIL_URL = "https://q.10jqka.com.cn/gn/detail/code/{code}/"
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36"
)


@dataclass(frozen=True)
class ConceptMember:
    symbol: str
    name: str
    pct: float


@dataclass(frozen=True)
class ConceptSnapshot:
    name: str
    code: str
    pct: float
    turnover_yi: float
    up_count: int
    down_count: int
    members: tuple[ConceptMember, ...]


@dataclass(frozen=True)
class StockSeedData:
    symbol: str
    name: str
    concepts: list[str]


def collect_ths_hot_stock_pool(
    akshare: Any,
    *,
    top_concepts: int,
    max_stocks: int,
    cache_path: Path | None,
    http_get: Callable[..., Any] = requests.get,
    today: date | None = None,
) -> dict[str, StockSeedData]:
    current_date = today or date.today()
    concepts = _load_cached_concepts(cache_path, current_date, top_concepts)
    if concepts is None:
        concepts = _fetch_concepts(
            akshare,
            top_concepts=top_concepts,
            http_get=http_get,
        )
        if concepts:
            _write_cached_concepts(cache_path, current_date, top_concepts, concepts)
    if not concepts:
        return {}
    return _build_stock_pool(concepts, max_stocks=max_stocks)


def rank_stock_concepts(
    symbol: str,
    concepts: list[ConceptSnapshot],
    *,
    limit: int = 3,
) -> list[str]:
    ranked: list[tuple[float, str]] = []
    for concept in concepts:
        member = next((item for item in concept.members if item.symbol == symbol), None)
        if member is not None:
            ranked.append((concept_heat_score(concept, member), concept.name))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [name for _, name in ranked[:limit]]


def concept_heat_score(concept: ConceptSnapshot, member: ConceptMember) -> float:
    board_strength = _clamp((concept.pct + 5.0) / 10.0)
    breadth_total = max(concept.up_count + concept.down_count, 1)
    breadth = _clamp(((concept.up_count - concept.down_count) / breadth_total + 1.0) / 2.0)
    activity = _clamp(math.log1p(max(concept.turnover_yi, 0.0)) / math.log1p(2000.0))
    sync = _clamp(1.0 - abs(member.pct - concept.pct) / 20.0)
    return board_strength * 0.55 + breadth * 0.25 + activity * 0.10 + sync * 0.10


def _fetch_concepts(
    akshare: Any,
    *,
    top_concepts: int,
    http_get: Callable[..., Any],
) -> list[ConceptSnapshot]:
    response = http_get(
        FUND_FLOW_URL,
        headers={
            "User-Agent": USER_AGENT,
            "Referer": FUND_FLOW_REFERER,
            "X-Requested-With": "XMLHttpRequest",
        },
        timeout=20,
    )
    response.raise_for_status()
    hot_rows = parse_fund_flow_page(response.text)[:top_concepts]
    names = akshare.stock_board_concept_name_ths()
    code_by_name = {
        str(row.get("name", "")).strip(): str(row.get("code", "")).strip()
        for row in names.to_dict(orient="records")
    }
    concepts: list[ConceptSnapshot] = []
    for row in hot_rows:
        name = str(row["name"])
        code = code_by_name.get(name)
        if not code:
            continue
        try:
            detail = http_get(
                CONCEPT_DETAIL_URL.format(code=code),
                headers={"User-Agent": USER_AGENT, "Referer": FUND_FLOW_REFERER},
                timeout=20,
            )
            detail.raise_for_status()
            snapshot = parse_concept_detail(name, code, detail.text)
        except Exception:
            continue
        if snapshot.members:
            concepts.append(snapshot)
    return concepts


def _build_stock_pool(
    concepts: list[ConceptSnapshot],
    *,
    max_stocks: int,
) -> dict[str, StockSeedData]:
    stock_concepts: dict[str, list[ConceptSnapshot]] = {}
    stock_names: dict[str, str] = {}
    stock_pct: dict[str, float] = {}
    for concept in concepts:
        for member in concept.members:
            stock_concepts.setdefault(member.symbol, []).append(concept)
            stock_names.setdefault(member.symbol, member.name)
            stock_pct[member.symbol] = max(stock_pct.get(member.symbol, member.pct), member.pct)

    def rank(symbol: str) -> tuple[float, float, str]:
        best_score = max(
            concept_heat_score(
                concept,
                next(item for item in concept.members if item.symbol == symbol),
            )
            for concept in stock_concepts[symbol]
        )
        return (-best_score, -stock_pct[symbol], symbol)

    selected = sorted(stock_concepts, key=rank)[:max_stocks]
    return {
        symbol: StockSeedData(
            symbol=symbol,
            name=stock_names[symbol],
            concepts=rank_stock_concepts(symbol, stock_concepts[symbol], limit=3),
        )
        for symbol in selected
    }


def _load_cached_concepts(
    cache_path: Path | None,
    current_date: date,
    top_concepts: int,
) -> list[ConceptSnapshot] | None:
    if cache_path is None or not cache_path.exists():
        return None
    try:
        payload = json.loads(cache_path.read_text(encoding="utf-8"))
        if payload.get("date") != current_date.isoformat():
            return None
        if int(payload.get("top_concepts", 0)) < top_concepts:
            return None
        return [_concept_from_dict(item) for item in payload.get("concepts", [])]
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return None


def _write_cached_concepts(
    cache_path: Path | None,
    current_date: date,
    top_concepts: int,
    concepts: list[ConceptSnapshot],
) -> None:
    if cache_path is None:
        return
    payload = {
        "date": current_date.isoformat(),
        "top_concepts": top_concepts,
        "concepts": [_concept_to_dict(item) for item in concepts],
    }
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = cache_path.with_suffix(cache_path.suffix + ".tmp")
    try:
        temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(temporary, cache_path)
    finally:
        if temporary.exists():
            temporary.unlink()


def _concept_to_dict(concept: ConceptSnapshot) -> dict[str, object]:
    return {
        "name": concept.name,
        "code": concept.code,
        "pct": concept.pct,
        "turnover_yi": concept.turnover_yi,
        "up_count": concept.up_count,
        "down_count": concept.down_count,
        "members": [
            {"symbol": item.symbol, "name": item.name, "pct": item.pct}
            for item in concept.members
        ],
    }


def _concept_from_dict(payload: dict[str, object]) -> ConceptSnapshot:
    members = tuple(
        ConceptMember(
            symbol=str(item["symbol"]),
            name=str(item["name"]),
            pct=float(item["pct"]),
        )
        for item in payload.get("members", [])
    )
    return ConceptSnapshot(
        name=str(payload["name"]),
        code=str(payload["code"]),
        pct=float(payload["pct"]),
        turnover_yi=float(payload["turnover_yi"]),
        up_count=int(payload["up_count"]),
        down_count=int(payload["down_count"]),
        members=members,
    )


def parse_fund_flow_page(html: str) -> list[dict[str, object]]:
    frame = pd.read_html(StringIO(html))[0]
    rows: list[dict[str, object]] = []
    for row in frame.to_dict(orient="records"):
        name = str(row.get("行业", "")).strip()
        pct = _number(row.get("涨跌幅"))
        company_count = _integer(row.get("公司家数"))
        if name and pct is not None:
            rows.append({"name": name, "pct": pct, "company_count": company_count})
    return rows


def parse_concept_detail(name: str, code: str, html: str) -> ConceptSnapshot:
    soup = BeautifulSoup(html, features="html.parser")
    info = soup.select_one(".board-infos")
    values: dict[str, str] = {}
    if info is not None:
        labels = info.find_all("dt")
        details = info.find_all("dd")
        values = {
            label.get_text(" ", strip=True): detail.get_text(" ", strip=True)
            for label, detail in zip(labels, details, strict=False)
        }

    breadth = re.findall(r"\d+", values.get("涨跌家数", ""))
    up_count = int(breadth[0]) if breadth else 0
    down_count = int(breadth[1]) if len(breadth) > 1 else 0
    members: list[ConceptMember] = []
    for frame in pd.read_html(StringIO(html)):
        if "代码" not in frame.columns or "名称" not in frame.columns:
            continue
        pct_column = next((column for column in frame.columns if str(column).startswith("涨跌幅")), None)
        if pct_column is None:
            continue
        for row in frame.to_dict(orient="records"):
            symbol = str(row.get("代码", "")).strip().split(".")[0].zfill(6)[-6:]
            member_name = str(row.get("名称", symbol)).strip()
            pct = _number(row.get(pct_column))
            if symbol.isdigit() and pct is not None:
                members.append(ConceptMember(symbol=symbol, name=member_name, pct=pct))
        break

    return ConceptSnapshot(
        name=name,
        code=code,
        pct=_number(values.get("板块涨幅")) or 0.0,
        turnover_yi=_number(values.get("成交额(亿)")) or 0.0,
        up_count=up_count,
        down_count=down_count,
        members=tuple(members),
    )


def _integer(value: object) -> int:
    number = _number(value)
    return int(number) if number is not None else 0


def _clamp(value: float) -> float:
    return max(0.0, min(value, 1.0))


def _number(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None
