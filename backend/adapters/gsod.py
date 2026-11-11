"""NOAA NCEI Global Surface Summary of the Day (GSOD) adapter.

This is a fallback for station-level daily values when CMA station data is not
available.  It is *not* a CMA station archive and it is not a city-average
product.  GSOD daily precipitation is summarised on a GMT day and may include
part of the previous day's precipitation.

API:
  https://www.ncei.noaa.gov/access/services/data/v1?dataset=global-summary-of-the-day
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from .http_client import cached_json

BASE = "https://www.ncei.noaa.gov/access/services/data/v1"
DEFAULT_STATION = "54511099999"


def _gsod_station(station: str) -> str:
    value = re.sub(r"\D", "", str(station or ""))
    if len(value) == 5:
        return value + "099999"
    return value or DEFAULT_STATION


def _num(value, missing=None):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if missing is not None and abs(number - missing) < 0.001:
        return None
    return number


def _f_to_c(value):
    return None if value is None else round((value - 32) * 5 / 9, 1)


def _inch_to_mm(value):
    return None if value is None else round(value * 25.4, 1)


def _knot_to_ms(value):
    return None if value is None else round(value * 0.514444, 1)


def _mile_to_km(value):
    return None if value is None else round(value * 1.609344, 1)


def _parse_rows(payload) -> list[dict]:
    rows = []
    if isinstance(payload, dict):
        payload = payload.get("data") or []
    if not isinstance(payload, list):
        return rows
    for raw in payload:
        if not isinstance(raw, dict):
            continue
        day = str(raw.get("DATE") or "")[:10]
        if not day:
            continue
        flags = str(raw.get("FRSHTT") or "").ljust(6, "0")
        rows.append({
            "date": day,
            "temp_c": _f_to_c(_num(raw.get("TEMP"), 9999.9)),
            "dewpoint_c": _f_to_c(_num(raw.get("DEWP"), 9999.9)),
            "temp_max_c": _f_to_c(_num(raw.get("MAX"), 9999.9)),
            "temp_min_c": _f_to_c(_num(raw.get("MIN"), 9999.9)),
            "prcp_mm": _inch_to_mm(_num(raw.get("PRCP"), 99.99)),
            "slp_hpa": _num(raw.get("SLP"), 9999.9),
            "stp_hpa": _num(raw.get("STP"), 9999.9),
            "wind_ms": _knot_to_ms(_num(raw.get("WDSP"), 999.9)),
            "wind_max_ms": _knot_to_ms(_num(raw.get("MXSPD"), 999.9)),
            "gust_ms": _knot_to_ms(_num(raw.get("GUST"), 999.9)),
            "visibility_km": _mile_to_km(_num(raw.get("VISIB"), 999.9)),
            "fog": flags[0] == "1",
            "rain_flag": flags[1] == "1",
            "snow": flags[2] == "1",
            "hail": flags[3] == "1",
            "thunder": flags[4] == "1",
        })
    return sorted(rows, key=lambda item: item["date"])


def _fetch_year(station: str, year: int) -> dict:
    url = (
        f"{BASE}?dataset=global-summary-of-the-day&stations={station}"
        f"&startDate={year}-01-01&endDate={year}-12-31&format=json"
    )
    # Historical years are immutable; only the current year needs a short TTL.
    ttl = 3600 if year >= datetime.now().year else 365 * 24 * 3600
    cached = cached_json(url, ttl=ttl, timeout=90)
    return {
        "year": year,
        "rows": _parse_rows(cached.get("json")),
        "url": url,
        "cache": cached.get("cache"),
        "fetched_at": cached.get("fetched_at_iso"),
        "sha256": cached.get("sha256"),
    }


def _stats(rows: list[dict]) -> dict:
    def values(key):
        return [r[key] for r in rows if r.get(key) is not None]

    rain = values("prcp_mm")
    temp = values("temp_c")
    tmax = values("temp_max_c")
    tmin = values("temp_min_c")
    return {
        "days": len(rows),
        "rain_days": sum(1 for value in rain if value > 0),
        "rain_sum_mm": round(sum(rain), 1) if rain else None,
        "rain_max_mm": round(max(rain), 1) if rain else None,
        "rain_min_mm": round(min(rain), 1) if rain else None,
        "rain_avg_mm": round(sum(rain) / len(rain), 1) if rain else None,
        "temp_max_c": round(max(tmax), 1) if tmax else None,
        "temp_min_c": round(min(tmin), 1) if tmin else None,
        "temp_avg_c": round(sum(temp) / len(temp), 1) if temp else None,
    }


def get_daily(station: str, start: str, end: str, ttl: int = 3600) -> dict:
    if not re.fullmatch(r"(?:19|20)\d{2}-\d{2}-\d{2}", str(start)) or not re.fullmatch(r"(?:19|20)\d{2}-\d{2}-\d{2}", str(end)):
        raise ValueError("日期格式应为 YYYY-MM-DD")
    start_day = date.fromisoformat(start)
    end_day = date.fromisoformat(end)
    if end_day < start_day:
        raise ValueError("结束日期不能早于开始日期")
    if (end_day - start_day).days > 366 * 70:
        raise ValueError("GSOD 单次查询范围不能超过 70 年")

    gsod_station = _gsod_station(station)
    rows = []
    years = []
    caches = []
    urls = []
    fetched = []
    for year in range(start_day.year, end_day.year + 1):
        part = _fetch_year(gsod_station, year)
        years.append(year)
        caches.append(part["cache"])
        urls.append(part["url"])
        fetched.append(part["fetched_at"])
        for row in part["rows"]:
            day = row["date"]
            if start <= day <= end:
                rows.append(row)

    stats = _stats(rows)
    return {
        "adapter": "noaa_gsod_daily",
        "station": str(station),
        "gsod_station": gsod_station,
        "start": start,
        "end": end,
        "years": years,
        "count": len(rows),
        "rows": rows,
        "summary": stats,
        "missing_days": (end_day - start_day).days + 1 - len(rows),
        "source_urls": urls,
        "page_url": "https://www.ncei.noaa.gov/access/search/data-search/global-summary-of-the-day",
        "archive_url": "https://www.ncei.noaa.gov/data/global-summary-of-the-day/archive/",
        "fetched_at": max((x for x in fetched if x), default=""),
        "cache": "hit" if caches and all(x == "hit" for x in caches) else "miss",
        "note": (
            "NOAA GSOD 是 WMO/GTS 交换站日汇总，按 GMT 统计；PRCP 可能包含前一日部分时段。"
            "54511 为北京 WMO 站（可能对应机场站），不是 CMA 官方站点档案，也不能代表北京全市平均。"
            "2025 年档案可能不完整，2026 年暂无数据。"
        ),
    }
