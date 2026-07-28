"""Collect and rank hot stock concepts published by Tonghuashun."""

from dataclasses import dataclass
from io import StringIO
import re

from bs4 import BeautifulSoup
import pandas as pd


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
    soup = BeautifulSoup(html, features="lxml")
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


def _number(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(",", "").replace("%", "").strip())
    except (TypeError, ValueError):
        return None
