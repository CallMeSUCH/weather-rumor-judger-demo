"""datashareclub.com 近 30 天城市日值（第三方辅助）。

The public city page exposes 30-day daily series in JavaScript arrays.  It is
useful for filling a recent process window, but the platform does not publish
its upstream source or accuracy guarantee.  Treat it as auxiliary only.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta

from .http_client import cached_text
from .china_weather import CITY_CODES, _clean_city

BASE = "https://datashareclub.com/location"


def _extract_range(text: str):
    m = re.search(r'"startDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"', text)
    n = re.search(r'"endDate"\s*:\s*"(\d{4}-\d{2}-\d{2})"', text)
    if m and n:
        return date.fromisoformat(m.group(1)), date.fromisoformat(n.group(1))
    m = re.search(r"(20\d{2})-(\d{2})-(\d{2})至(20\d{2})-(\d{2})-(\d{2})", text)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3))), date(int(m.group(4)), int(m.group(5)), int(m.group(6)))
    return None, None


def _pairs(text: str, name: str):
    m = re.search(rf"var\s+{name}\s*=\s*(\[.*?\])\s*;", text, re.S)
    if not m:
        return []
    try:
        return json.loads(re.sub(r",\s*]", "]", m.group(1)))
    except json.JSONDecodeError:
        return []


def get_window(city: str, date_text: str, before: int = 2, after: int = 1, ttl: int = 1800) -> dict:
    name = _clean_city(city)
    code = CITY_CODES.get(name)
    if not code:
        raise KeyError(f"暂未配置 datashareclub 城市码：{city}")
    center = date.fromisoformat(date_text)
    before = max(0, min(int(before), 7))
    after = max(0, min(int(after), 7))

    url = f"{BASE}/{code}/weatherd.html"
    cached = cached_text(
        url,
        ttl=ttl,
        encoding="utf-8",
        headers={"Referer": "https://datashareclub.com/", "Accept": "*/*"},
    )
    text = cached["text"]
    start, end = _extract_range(text)
    rain_pairs = _pairs(text, "rain_data")
    temp_pairs = _pairs(text, "wd_data")
    if not (rain_pairs or temp_pairs):
        return {
            "adapter": "datashareclub_window",
            "city": name,
            "date": date_text,
            "rows": [],
            "available": False,
            "source_url": url,
            "page_url": url,
            "fetched_at": cached["fetched_at_iso"],
            "cache": cached.get("cache"),
            "note": "datashareclub 页面未找到 30 天数据数组；可能页面结构变化或需要登录。",
        }

    start_year = start.year if start else center.year
    start_month = start.month if start else center.month

    def full_date(label: str):
        m = re.fullmatch(r"(\d{2})/(\d{2})", str(label).strip())
        if not m:
            return None
        month, day = int(m.group(1)), int(m.group(2))
        year = start_year + (1 if month < start_month else 0)
        try:
            return date(year, month, day)
        except ValueError:
            return None

    rain = {}
    for item in rain_pairs:
        if isinstance(item, list) and len(item) >= 2:
            d = full_date(item[0])
            if d:
                try:
                    rain[d] = float(item[1])
                except (TypeError, ValueError):
                    pass
    temp = {}
    for item in temp_pairs:
        if isinstance(item, list) and len(item) >= 3:
            d = full_date(item[0])
            if d:
                temp[d] = {
                    "temp_max_c": item[1],
                    "temp_min_c": item[2],
                    "temp_avg_c": item[3] if len(item) > 3 else None,
                    "feels_like_c": item[4] if len(item) > 4 else None,
                }

    rows = []
    for offset in range(-before, after + 1):
        d = center + timedelta(days=offset)
        t = temp.get(d) or {}
        rows.append({
            "date": d.isoformat(),
            "rain_mm": rain.get(d),
            "temp_max_c": t.get("temp_max_c"),
            "temp_min_c": t.get("temp_min_c"),
            "temp_avg_c": t.get("temp_avg_c"),
            "feels_like_c": t.get("feels_like_c"),
        })

    available = [r for r in rows if r["rain_mm"] is not None or r["temp_max_c"] is not None]
    return {
        "adapter": "datashareclub_window",
        "city": name,
        "date": date_text,
        "start": rows[0]["date"] if rows else date_text,
        "end": rows[-1]["date"] if rows else date_text,
        "page_range": [start.isoformat() if start else None, end.isoformat() if end else None],
        "rows": rows,
        "available": bool(available),
        "source_url": url,
        "page_url": url,
        "fetched_at": cached["fetched_at_iso"],
        "cache": cached.get("cache"),
        "sha256": cached["sha256"],
        "note": (
            "datashareclub 是第三方历史天气聚合页，只公开当前近 30 天日值；"
            "上游来源与精度未公开，不能作为 CMA 官方证据，只能辅助补过程窗口。"
        ),
    }
