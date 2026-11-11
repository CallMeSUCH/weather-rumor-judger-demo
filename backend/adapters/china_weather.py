"""China Weather Network (中国天气网) city daily observations.

Public calendar endpoint (no account):
  http://d1.weather.com.cn/calendar_new/2026/101010100_202610.html

It returns a JS variable `fc40` with per-day records. For recent days:
  cla = "obs", maxobs, minobs, rainobs

This is a city-level observed daily value published by China Weather
(CMA public meteorological service media), not the raw CMA station archive.
Older months may only contain climate averages (`cla="history"`).
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta

from .http_client import cached_text

BASE = "http://d1.weather.com.cn/calendar_new"

CITY_CODES = {
    "北京": "101010100",
    "上海": "101020100",
    "天津": "101030100",
    "重庆": "101040100",
    "河北": "101090101", "石家庄": "101090101",
    "山西": "101100101", "太原": "101100101",
    "内蒙古": "101080101", "呼和浩特": "101080101",
    "辽宁": "101070101", "沈阳": "101070101",
    "吉林": "101060101", "长春": "101060101",
    "黑龙江": "101050101", "哈尔滨": "101050101",
    "江苏": "101190101", "南京": "101190101",
    "浙江": "101210101", "杭州": "101210101", "宁波": "101210401", "温州": "101210701",
    "安徽": "101220101", "合肥": "101220101",
    "福建": "101230101", "福州": "101230101", "厦门": "101230201",
    "江西": "101240101", "南昌": "101240101",
    "山东": "101120101", "济南": "101120101", "青岛": "101120201",
    "河南": "101180101", "郑州": "101180101",
    "湖北": "101200101", "武汉": "101200101",
    "湖南": "101250101", "长沙": "101250101",
    "广东": "101280101", "广州": "101280101", "深圳": "101280601", "珠海": "101280701", "湛江": "101281001",
    "阳江": "101281801", "广东阳江": "101281801", "阳春": "101281801",
    "广西": "101300101", "南宁": "101300101",
    "海南": "101310101", "海口": "101310101", "三亚": "101310201", "文昌": "101310212",
    "四川": "101270101", "成都": "101270101",
    "贵州": "101260101", "贵阳": "101260101",
    "云南": "101290101", "昆明": "101290101",
    "西藏": "101140101", "拉萨": "101140101",
    "陕西": "101110101", "西安": "101110101",
    "甘肃": "101160101", "兰州": "101160101",
    "青海": "101150101", "西宁": "101150101",
    "宁夏": "101170101", "银川": "101170101",
    "新疆": "101130101", "乌鲁木齐": "101130101",
    "香港": "101320101", "澳门": "101330101", "台北": "101340101",
    "台山": "101281106",
}


def _clean_city(city: str) -> str:
    text = re.sub(r"（.*?）", "", str(city or ""))
    return text.replace("省", "").replace("市", "").replace("自治区", "").strip()


def _load_month(code: str, year: str, month: str, ttl: int = 3600) -> dict:
    url = f"{BASE}/{year}/{code}_{year}{month}.html"
    cached = cached_text(
        url,
        ttl=ttl,
        encoding="utf-8",
        headers={"Referer": "http://www.weather.com.cn/", "Accept": "*/*"},
    )
    text = cached["text"]
    found = re.search(r"var\s+fc40\s*=\s*(\[.*?\])\s*;?", text, re.S)
    if not found:
        raise RuntimeError("中国天气网返回格式变化，未找到 fc40 数据")
    return {
        "rows": json.loads(found.group(1)),
        "cached": cached,
        "url": url,
    }


def _last_obs(rows: list[dict]) -> dict | None:
    last = None
    for row in rows:
        if row.get("cla") == "obs" and row.get("rainobs") not in (None, ""):
            last = row
    return last


def get_daily(city: str, date: str, ttl: int = 3600) -> dict:
    name = _clean_city(city)
    code = CITY_CODES.get(name)
    if not code:
        raise KeyError(f"暂未配置中国天气网城市码：{city}")
    m = re.fullmatch(r"(20\d{2})-(\d{2})-(\d{2})", str(date))
    if not m:
        raise ValueError("日期格式应为 YYYY-MM-DD")
    year, month, day = m.group(1), m.group(2), m.group(3)
    month_data = _load_month(code, year, month, ttl=ttl)
    rows = month_data["rows"]
    target = None
    for row in rows:
        if row.get("date") == f"{year}{month}{day}":
            target = row
            break

    def num(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    item = None
    if target:
        item = {
            "date": f"{year}-{month}-{day}",
            "class": target.get("cla"),
            "updated": target.get("update"),
            "rain_mm": num(target.get("rainobs")),
            "temp_max_c": num(target.get("maxobs")),
            "temp_min_c": num(target.get("minobs")),
        }

    month_obs = _last_obs(rows)
    latest_obs = month_obs
    latest_obs_month = f"{year}-{month}" if month_obs else None
    latest_obs_source = month_data["url"] if month_obs else None

    # Old monthly archives often contain only climate averages, not daily
    # observations. Fall back to the current month so the UI can still show
    # when this source was last observed.
    now = datetime.now()
    current_key = f"{now.year:04d}-{now.month:02d}"
    if not latest_obs and current_key != f"{year}-{month}":
        try:
            current_data = _load_month(code, f"{now.year:04d}", f"{now.month:02d}", ttl=ttl)
            current_obs = _last_obs(current_data["rows"])
            if current_obs:
                latest_obs = current_obs
                latest_obs_month = current_key
                latest_obs_source = current_data["url"]
        except Exception:
            pass

    return {
        "adapter": "china_weather_daily",
        "city": name,
        "city_code": code,
        "date": f"{year}-{month}-{day}",
        "item": item,
        "target_month_obs_count": sum(
            1 for row in rows
            if row.get("cla") == "obs" and row.get("rainobs") not in (None, "")
        ),
        "last_observed_date": latest_obs.get("date") if latest_obs else None,
        "last_observed_month": latest_obs_month,
        "last_observed_source_url": latest_obs_source,
        "source_url": month_data["url"],
        "page_url": "http://www.weather.com.cn/",
        "fetched_at": month_data["cached"]["fetched_at_iso"],
        "sha256": month_data["cached"]["sha256"],
        "cache": month_data["cached"].get("cache"),
        "note": (
            "中国天气网城市日值（官方媒体），不是 CMA 原始站点档案；"
            "只有最近一段日期保留逐日 obs 观测，较早月份通常只有历史均值。"
        ),
    }


def get_window(city: str, date: str, before: int = 2, after: int = 1, ttl: int = 3600) -> dict:
    """Return a small daily process window around an event date."""
    name = _clean_city(city)
    code = CITY_CODES.get(name)
    if not code:
        raise KeyError(f"暂未配置中国天气网城市码：{city}")
    m = re.fullmatch(r"(20\d{2})-(\d{2})-(\d{2})", str(date))
    if not m:
        raise ValueError("日期格式应为 YYYY-MM-DD")
    center = datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    before = max(0, min(int(before), 7))
    after = max(0, min(int(after), 7))
    start = center - timedelta(days=before)
    end = center + timedelta(days=after)

    month_rows = {}
    sources = []
    fetched = []
    for offset in range(-before, after + 1):
        day = center + timedelta(days=offset)
        key = (day.year, day.month)
        if key not in month_rows:
            data = _load_month(code, f"{day.year:04d}", f"{day.month:02d}", ttl=ttl)
            month_rows[key] = data["rows"]
            sources.append(data["url"])
            fetched.append(data["cached"]["fetched_at_iso"])

    def row_for(day):
        rows = month_rows.get((day.year, day.month), [])
        wanted = f"{day.year:04d}{day.month:02d}{day.day:02d}"
        return next((row for row in rows if row.get("date") == wanted), None)

    def num(value):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None

    rows = []
    for offset in range(-before, after + 1):
        day = center + timedelta(days=offset)
        raw = row_for(day)
        rows.append({
            "date": day.strftime("%Y-%m-%d"),
            "class": raw.get("cla") if raw else None,
            "rain_mm": num(raw.get("rainobs")) if raw else None,
            "temp_max_c": num(raw.get("maxobs")) if raw else None,
            "temp_min_c": num(raw.get("minobs")) if raw else None,
        })

    observed = [
        row for row in rows
        if row["class"] == "obs" and row["rain_mm"] is not None
    ]
    rain = [row["rain_mm"] for row in observed]
    tmax = [row["temp_max_c"] for row in observed if row["temp_max_c"] is not None]
    tmin = [row["temp_min_c"] for row in observed if row["temp_min_c"] is not None]
    return {
        "adapter": "china_weather_window",
        "city": name,
        "city_code": code,
        "date": date,
        "start": rows[0]["date"] if rows else date,
        "end": rows[-1]["date"] if rows else date,
        "rows": rows,
        "obs_days": len(observed),
        "summary": {
            "rain_sum_mm": round(sum(rain), 1) if rain else None,
            "rain_max_mm": round(max(rain), 1) if rain else None,
            "rain_min_mm": round(min(rain), 1) if rain else None,
            "rain_avg_mm": round(sum(rain) / len(rain), 1) if rain else None,
            "temp_max_c": round(max(tmax), 1) if tmax else None,
            "temp_min_c": round(min(tmin), 1) if tmin else None,
        },
        "source_urls": list(dict.fromkeys(sources)),
        "source_url": sources[0] if sources else "",
        "page_url": "http://www.weather.com.cn/",
        "fetched_at": max((x for x in fetched if x), default=""),
        "note": (
            "中国天气网过程窗口（官方媒体城市日值），不是 CMA 原始站点档案；"
            "只有最近一段日期有逐日 obs，较早月份通常只有历史均值；"
            "城市日值不等于北京全市平均。"
        ),
    }
