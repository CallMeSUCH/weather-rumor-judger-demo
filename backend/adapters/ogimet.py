"""Ogimet SYNOP adapter — a free alternative for station observations.

Ogimet publishes WMO SYNOP reports from the GTS:
  https://www.ogimet.com/cgi-bin/getsynop?begin=202510080000&end=202510092359&station=54511

This is NOT the CMA station archive. It is WMO/GTS SYNOP data, free to query,
with variable completeness. Use it as an independent cross-check.
"""
from __future__ import annotations

import re
from datetime import datetime

from .http_client import cached_text

BASE = "https://www.ogimet.com/cgi-bin/getsynop"


def _norm_time(value: str, end: bool = False) -> str:
    s = str(value).strip().replace("-", "").replace(":", "").replace(" ", "")
    if len(s) == 8:  # YYYYMMDD
        return s + ("2359" if end else "0000")
    if len(s) == 10:  # YYYYMMDDHH
        return s + ("59" if end else "00")
    if len(s) == 12:
        return s
    raise ValueError(f"时间格式不支持：{value}（用 YYYY-MM-DD 或 YYYYMMDDHHMM）")


def _temp(group: str) -> float | None:
    """Parse 1snTTT / 2snTdTdTd (tenths); sn=0 positive, sn=1 negative."""
    if not re.fullmatch(r"[12][01]\d{3}", group):
        return None
    sign = -1 if group[1] == "1" else 1
    return sign * int(group[2:]) / 10.0


def _parse_line(line: str) -> dict | None:
    parts = line.split(",")
    if len(parts) < 6:
        return None
    station = parts[0].strip()
    try:
        dt = datetime(int(parts[1]), int(parts[2]), int(parts[3]), int(parts[4]), int(parts[5]))
    except Exception:
        return None
    body = ",".join(parts[6:])
    tokens = body.replace("=", " ").split()
    # Drop the AAXX header, day/hour group and station ID; keep only groups
    # after the station number.
    if station in tokens:
        tokens = tokens[tokens.index(station) + 1:]
    # Section 333 contains max/min temperature groups; do not let them
    # overwrite the main observation.
    if "333" in tokens:
        tokens = tokens[:tokens.index("333")]
    temp = dew = msl = stn = None
    wind_dir = wind_speed = precip = None
    precip_trace = False
    precip_period_h = None
    weather_code = weather_past1 = weather_past2 = None
    for tok in tokens:
        if re.fullmatch(r"1[01]\d{3}", tok) and temp is None:
            temp = _temp(tok)
        elif re.fullmatch(r"2[01]\d{3}", tok) and dew is None:
            dew = _temp(tok)
        elif re.fullmatch(r"4\d{4}", tok):
            v = int(tok[1:]) / 10.0
            msl = v + 1000.0 if v < 500 else v
        elif re.fullmatch(r"3\d{4}", tok):
            v = int(tok[1:]) / 10.0
            stn = v + 1000.0 if v < 500 else v
        elif re.fullmatch(r"0\d{4}", tok) and wind_dir is None:
            wind_dir = int(tok[1:3]) * 10
            wind_speed = int(tok[3:5])
        elif re.fullmatch(r"6\d{4}", tok) and precip is None:
            # 6RRRt: RRR = 000 no precipitation, 001-988 mm,
            # 989 = >=989 mm, 990 = trace, 991-999 = 0.1-0.9 mm.
            rrr = int(tok[1:4])
            t = int(tok[4])
            if rrr == 0:
                precip = 0.0
            elif rrr <= 988:
                precip = float(rrr)
            elif rrr == 989:
                precip = 989.0
            elif rrr == 990:
                precip = 0.0
                precip_trace = True
            else:
                precip = (rrr - 990) / 10.0
            precip_period_h = {1: 6, 2: 12, 3: 18, 4: 24, 5: 1, 6: 2, 7: 3, 8: 9, 9: 15}.get(t)
        elif re.fullmatch(r"7\d{4}", tok) and weather_code is None:
            weather_code = int(tok[1:3])
            weather_past1 = int(tok[3])
            weather_past2 = int(tok[4])
    return {
        "station": station,
        "datetime_utc": dt.strftime("%Y-%m-%d %H:%M"),
        "temperature_c": temp,
        "dewpoint_c": dew,
        "pressure_msl_hpa": msl,
        "pressure_station_hpa": stn,
        "wind_dir_deg": wind_dir,
        "wind_speed_ms": wind_speed,
        "precip_mm": precip,
        "precip_trace": precip_trace,
        "precip_period_h": precip_period_h,
        "weather_code": weather_code,
        "weather_past1": weather_past1,
        "weather_past2": weather_past2,
        "raw": line.strip(),
    }


def get_synop(station: str, start: str, end: str, ttl: int = 1800) -> dict:
    begin = _norm_time(start, end=False)
    finish = _norm_time(end, end=True)
    # Ogimet's `station=` parameter can return an enormous, slow response.
    # Query the WMO block (first two digits) and filter the station locally.
    block = str(station)[:2] if len(str(station)) >= 2 else str(station)
    url = f"{BASE}?begin={begin}&end={finish}&block={block}"
    cached = cached_text(url, ttl=ttl, timeout=20, encoding="utf-8")
    items = []
    for line in cached["text"].splitlines():
        if not line.startswith(str(station)):
            continue
        parsed = _parse_line(line)
        if parsed:
            items.append(parsed)
    return {
        "adapter": "ogimet_synop",
        "station": str(station),
        "start": begin,
        "end": finish,
        "count": len(items),
        "items": items,
        "source_url": url,
        "page_url": "https://www.ogimet.com/synops.phtml.en",
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": (
            "WMO SYNOP（经 Ogimet）免费查询；不是 CMA 官方站点档案，"
            "覆盖与完整度随站点/时次变化；建议只作交叉核验。"
        ),
    }
