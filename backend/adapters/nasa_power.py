"""NASA POWER daily point data.

Free, no API key:
  https://power.larc.nasa.gov/api/temporal/daily/point
    ?parameters=PRECTOTCORR,T2M,T2M_MAX,T2M_MIN
    &community=RE&longitude=113.2644&latitude=23.1291
    &start=20260520&end=20260520&format=JSON

POWER is satellite/reanalysis, not a Chinese official station observation.
Use it as an independent auxiliary check, never as a CMA replacement.
"""
from __future__ import annotations

from urllib.parse import urlencode

from .http_client import cached_json

BASE = "https://power.larc.nasa.gov/api/temporal/daily/point"
DEFAULT_PARAMS = "PRECTOTCORR,T2M,T2M_MAX,T2M_MIN,WS2M,RH2M"


def _compact_date(value: str) -> str:
    s = str(value).strip().replace("-", "")
    if len(s) != 8 or not s.isdigit():
        raise ValueError(f"日期格式应为 YYYY-MM-DD：{value}")
    return s


def get_daily(lat: float, lon: float, start: str, end: str, parameters: str = DEFAULT_PARAMS, ttl: int = 3600) -> dict:
    params = {
        "parameters": parameters,
        "community": "RE",
        "longitude": lon,
        "latitude": lat,
        "start": _compact_date(start),
        "end": _compact_date(end),
        "format": "JSON",
    }
    url = f"{BASE}?{urlencode(params)}"
    cached = cached_json(url, ttl=ttl, encoding="utf-8")
    payload = cached["json"]
    parameter = (payload.get("properties") or {}).get("parameter") or {}
    dates = sorted({d for series in parameter.values() for d in series.keys()})
    rows = []
    flags = []
    for date in dates:
        row = {"date": f"{date[:4]}-{date[4:6]}-{date[6:]}"}
        for name, series in parameter.items():
            value = series.get(date)
            # POWER uses -999 for missing; do not let it poison summaries.
            if isinstance(value, (int, float)) and value <= -900:
                value = None
            row[name] = value
        rain = row.get("PRECTOTCORR")
        if isinstance(rain, (int, float)) and rain > 500:
            flags.append({"date": row["date"], "field": "PRECTOTCORR", "value": rain, "reason": "日降水 > 500 mm，疑似异常/未质控，不纳入交叉核验"})
            row["PRECTOTCORR"] = None
            row["_suspect"] = True
        rows.append(row)
    return {
        "adapter": "nasa_power",
        "quality_flags": flags,
        "latitude": lat,
        "longitude": lon,
        "start": f"{params['start'][:4]}-{params['start'][4:6]}-{params['start'][6:]}",
        "end": f"{params['end'][:4]}-{params['end'][4:6]}-{params['end'][6:]}",
        "parameters": parameters.split(","),
        "rows": rows,
        "source_url": url,
        "page_url": "https://power.larc.nasa.gov/data-access-viewer/",
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "NASA POWER 卫星/再分析日值，不是中国官方站点观测；用于独立交叉核验。已剔除 -999 缺测和 >500 mm/日 的异常降水。",
    }
