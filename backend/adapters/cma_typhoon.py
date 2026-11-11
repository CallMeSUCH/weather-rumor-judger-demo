"""CMA typhoon adapter (NMC typhoon JSON endpoints).

Endpoints used by typhoon.nmc.cn:
  /weatherservice/typhoon/jsons/list_default
  /weatherservice/typhoon/jsons/view_{id}
  /weatherservice/typhoon/jsons/maxYear
  /weatherservice/typhoon/jsons/forecastOrgs
  https://www.nmc.cn/dataservice/typhoon/news.json

Data is CMA/BABJ (Central Meteorological Observatory). Track times are UTC;
we convert to Beijing time (UTC+8) for display.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta

from .http_client import cached_text, cached_json

BASE = "https://typhoon.nmc.cn/weatherservice/typhoon/jsons"
LIST_URL = f"{BASE}/list_default"
YEAR_LIST_URL = f"{BASE}/list_{{year}}"
VIEW_URL = f"{BASE}/view_{{tid}}"
MAX_YEAR_URL = f"{BASE}/maxYear"
ORGS_URL = f"{BASE}/forecastOrgs"
NEWS_URL = "https://www.nmc.cn/dataservice/typhoon/news.json"

GRADE_CN = {
    "TD": "热带低压",
    "TS": "热带风暴",
    "STS": "强热带风暴",
    "TY": "台风",
    "STY": "强台风",
    "SuperTY": "超强台风",
}


def _parse_jsonp(text: str):
    start = text.find("(")
    end = text.rfind(")")
    if start == -1 or end == -1:
        raise ValueError("不是 JSONP 响应")
    body = text[start + 1:end].strip()
    # Some NMC endpoints use double parentheses: callback(({...}))
    while body.startswith("(") and body.endswith(")"):
        body = body[1:-1].strip()
    return json.loads(body)


def _clean_name(value: str) -> str:
    return (value or "").replace("\n", "").replace("\r", "").strip()


def _dt_utc_to_cn(raw: str) -> str:
    try:
        return (datetime.strptime(str(raw), "%Y%m%d%H%M") + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return str(raw)


def _parse_list(payload) -> list[dict]:
    items = []
    for row in payload.get("typhoonList") or []:
        # [id, name_en, name_cn, number, number2, ?, meaning, status]
        items.append({
            "id": row[0],
            "name_en": _clean_name(row[1]),
            "name_cn": _clean_name(row[2]),
            "number": str(row[3]) if row[3] is not None else None,
            "number2": str(row[4]) if len(row) > 4 and row[4] is not None else None,
            "meaning": row[6] if len(row) > 6 else None,
            "status": row[7] if len(row) > 7 else None,
        })
    return items


def get_list(ttl: int = 600) -> dict:
    cached = cached_text(LIST_URL, ttl=ttl, encoding="utf-8")
    payload = _parse_jsonp(cached["text"])
    items = _parse_list(payload)
    return {
        "adapter": "cma_typhoon_list",
        "items": items,
        "source_url": LIST_URL,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "CMA/NMC 当前年度台风列表；状态 start=活动中，stop=已结束。",
    }


def get_year_list(year: int, ttl: int = 86400) -> dict:
    url = YEAR_LIST_URL.format(year=int(year))
    cached = cached_text(url, ttl=ttl, encoding="utf-8")
    payload = _parse_jsonp(cached["text"])
    items = _parse_list(payload)
    return {
        "adapter": "cma_typhoon_year_list",
        "year": int(year),
        "items": items,
        "source_url": url,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": f"CMA/NMC {year} 年台风列表；早期年份的资料完整度可能不同。",
    }


def find_typhoon(name: str, year: int | None = None) -> dict | None:
    target = _clean_name(name).lower()
    items = get_year_list(year)["items"] if year else get_list()["items"]
    for item in items:
        keys = {str(item.get("name_cn", "")).lower(), str(item.get("name_en", "")).lower(), str(item.get("number", "")).lower()}
        if target in keys:
            return item
    return None


def get_track(tid: int, ttl: int = 600) -> dict:
    url = VIEW_URL.format(tid=tid)
    cached = cached_text(url, ttl=ttl, encoding="utf-8")
    payload = _parse_jsonp(cached["text"])
    ty = payload.get("typhoon")
    if not ty or len(ty) < 9:
        raise RuntimeError(f"台风 {tid} 轨迹为空")

    meta = {
        "id": ty[0],
        "name_en": _clean_name(ty[1]),
        "name_cn": _clean_name(ty[2]),
        "number": str(ty[3]) if ty[3] is not None else None,
        "meaning": ty[6] if len(ty) > 6 else None,
        "status": ty[7] if len(ty) > 7 else None,
    }

    points = []
    for p in ty[8] or []:
        if len(p) < 10:
            continue
        wind = p[7]
        points.append({
            "time_utc": p[1],
            "time_cn": _dt_utc_to_cn(p[1]),
            "grade": p[3],
            "grade_cn": GRADE_CN.get(p[3], p[3]),
            "lon": p[4],
            "lat": p[5],
            "pressure_hpa": p[6],
            "wind_ms": wind,
            "wind_kmh": round(float(wind) * 3.6, 1) if isinstance(wind, (int, float)) else None,
            "move_dir": p[8],
            "move_speed": p[9],
            "wind_radii": p[10] if len(p) > 10 else None,
        })

    if not points:
        raise RuntimeError(f"台风 {tid} 没有可解析的轨迹点")

    latest = points[-1]
    max_wind = max(points, key=lambda x: x.get("wind_ms") or 0)
    min_pressure = min(points, key=lambda x: x.get("pressure_hpa") or 9999)

    forecast = []
    raw_forecast = ty[8][-1][11] if len(ty[8][-1]) > 11 else {}
    for org, rows in (raw_forecast or {}).items():
        for row in rows or []:
            if len(row) < 8:
                continue
            lead = row[0]
            base = row[1]
            try:
                valid = (datetime.strptime(str(base), "%Y%m%d%H%M") + timedelta(hours=8 + int(lead))).strftime("%Y-%m-%d %H:%M")
            except Exception:
                valid = str(base)
            forecast.append({
                "org": row[6] if len(row) > 6 else org,
                "lead_hours": lead,
                "base_utc": base,
                "valid_time_cn": valid,
                "lon": row[2],
                "lat": row[3],
                "pressure_hpa": row[4],
                "wind_ms": row[5],
                "wind_kmh": round(float(row[5]) * 3.6, 1) if isinstance(row[5], (int, float)) else None,
                "grade": row[7] if len(row) > 7 else None,
                "grade_cn": GRADE_CN.get(row[7], row[7]) if len(row) > 7 else None,
            })

    return {
        "adapter": "cma_typhoon_track",
        **meta,
        "points": points,
        "latest": latest,
        "max_wind": max_wind,
        "min_pressure": min_pressure,
        "forecast": forecast,
        "source_url": f"https://typhoon.nmc.cn/web.html?tid={tid}",
        "api_url": url,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": (
            "CMA 台风业务强度通常按 2 分钟平均风速；风力等级 17 级按 10 分钟平均风速定义。"
            "两者不能直接等同；比较“17 级”必须注明平均时长与巅峰/登陆时态。"
        ),
    }


def get_news(ttl: int = 300) -> dict:
    cached = cached_json(NEWS_URL, ttl=ttl, encoding="utf-8")
    payload = cached["json"]
    data = payload.get("data") or {}
    items = data.get("list") or []
    parsed = {}
    for item in items:
        label = item.get("label") or ""
        if label:
            parsed[label] = item.get("text")
    return {
        "adapter": "cma_typhoon_news",
        "release_time": data.get("releaseTime"),
        "description": data.get("description"),
        "items": items,
        "parsed": parsed,
        "source_url": NEWS_URL,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "中央气象台台风快讯；用于核对最新位置、强度、最大风力、中心气压。",
    }


def get_by_name(name: str, year: int | None = None, ttl: int = 600) -> dict:
    item = find_typhoon(name, year=year)
    if not item:
        raise KeyError(f"未找到台风：{name}（{year or '当前年度'}列表）")
    track = get_track(item["id"], ttl=ttl)
    return {
        "adapter": "cma_typhoon",
        "year": year,
        "list_item": item,
        "track": track,
        "news": get_news() if not year else None,
        "source_url": track["source_url"],
        "note": track["note"] if not year else (
            track["note"] + " 历史个例来自 NMC 年度列表；台风快讯接口只提供当前，不冒充历史快讯。"
        ),
    }


def get_latest(ttl: int = 600) -> dict:
    items = get_list(ttl=ttl)["items"]
    if not items:
        raise RuntimeError("当前年度台风列表为空")
    active = next((x for x in items if x.get("status") == "start"), items[0])
    track = get_track(active["id"], ttl=ttl)
    return {
        "adapter": "cma_typhoon_latest",
        "list_item": active,
        "track": track,
        "news": get_news(),
        "source_url": track["source_url"],
        "note": track["note"],
    }
