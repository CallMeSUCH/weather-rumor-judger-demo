"""Meteostat bulk hourly station data (third-party, no account).

Bulk endpoint:
  https://bulk.meteostat.net/v2/hourly/54511.csv.gz

Important:
  - This is NOT the CMA station archive.
  - Meteostat's 54511 is associated with ZBAA (Beijing Capital Airport),
    not necessarily CMA's 54511 observatory. Coordinates differ.
  - Bulk data lags by about 1-2 months; check `last_date` in the response.
"""
from __future__ import annotations

import csv
import gzip
import io
import os
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

BULK = "https://bulk.meteostat.net/v2/hourly/{sid}.csv.gz"
COLS = [
    "date", "hour", "temp", "dwpt", "rhum", "prcp", "snow",
    "wdir", "wspd", "wpgt", "pres", "tsun", "coco",
]
BJT = timezone(timedelta(hours=8))
UTC = timezone.utc
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
USER_AGENT = "Mozilla/5.0 (compatible; MeteorologyTermChecker/0.1)"


def _cache_path(station: str) -> Path:
    safe = "".join(ch for ch in str(station) if ch.isdigit())
    return CACHE_DIR / f"meteostat_{safe}.csv.gz"


def _download(station: str, ttl: int = 86400) -> tuple[bytes, str]:
    path = _cache_path(station)
    if path.exists() and time.time() - path.stat().st_mtime < ttl:
        return path.read_bytes(), "hit"
    url = BULK.format(sid=station)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read()
    path.write_bytes(raw)
    return raw, "miss"


def _float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def get_hourly(station: str, date: str, ttl: int = 86400) -> dict:
    station = str(station).strip()
    if not station.isdigit():
        raise ValueError(f"站号必须是数字：{station}")
    try:
        y, m, d = map(int, str(date).split("-"))
        day = datetime(y, m, d)
    except Exception as exc:
        raise ValueError(f"日期格式应为 YYYY-MM-DD：{date}") from exc

    raw, cache_status = _download(station, ttl=ttl)
    text = gzip.decompress(raw).decode("utf-8", errors="replace")
    lo = datetime(y, m, d, tzinfo=BJT).astimezone(UTC)
    hi = lo + timedelta(days=1)

    rows = []
    last_date = None
    for rec in csv.reader(io.StringIO(text)):
        if len(rec) < 13:
            continue
        if last_date is None:
            last_date = rec[0]
        last_date = rec[0]
        try:
            ts = datetime.strptime(rec[0], "%Y-%m-%d").replace(hour=int(rec[1]), tzinfo=UTC)
        except Exception:
            continue
        if lo <= ts < hi:
            item = dict(zip(COLS, rec))
            item["time_bjt"] = ts.astimezone(BJT).strftime("%Y-%m-%d %H:%M")
            item["temp"] = _float(item.get("temp"))
            item["dwpt"] = _float(item.get("dwpt"))
            item["rhum"] = _float(item.get("rhum"))
            item["prcp"] = _float(item.get("prcp"))
            item["wdir"] = _float(item.get("wdir"))
            item["wspd"] = _float(item.get("wspd"))
            item["wpgt"] = _float(item.get("wpgt"))
            item["pres"] = _float(item.get("pres"))
            rows.append(item)

    temps = [r["temp"] for r in rows if r["temp"] is not None]
    precs = [r["prcp"] for r in rows if r["prcp"] is not None]
    winds = [r["wspd"] for r in rows if r["wspd"] is not None]
    summary = {
        "count": len(rows),
        "temp_max": max(temps) if temps else None,
        "temp_min": min(temps) if temps else None,
        "temp_avg": round(sum(temps) / len(temps), 1) if temps else None,
        "precip_sum": round(sum(precs), 1) if precs else None,
        "wind_max": max(winds) if winds else None,
    }
    return {
        "adapter": "meteostat_hourly",
        "station": station,
        "date": f"{y:04d}-{m:02d}-{d:02d}",
        "timezone": "BJT (UTC+8)",
        "count": len(rows),
        "rows": rows,
        "summary": summary,
        "last_date": last_date,
        "source_url": BULK.format(sid=station),
        "page_url": "https://dev.meteostat.net/bulk/hourly.html",
        "fetched_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime()),
        "cache": cache_status,
        "note": (
            "Meteostat 第三方整编逐时数据，不是 CMA 原始观测；"
            "54511 在 Meteostat 绑定 ZBAA（首都机场），与 CMA 54511 观象台坐标/含义可能不同；"
            "批量数据通常滞后 1–2 个月。"
        ),
    }
