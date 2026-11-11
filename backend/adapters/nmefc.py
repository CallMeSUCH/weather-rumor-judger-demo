"""National Marine Environmental Forecasting Center (NMEFC) adapter.

Public endpoints used by nmefc.cn:
  /api/data/warning
  /api/data/warnYear?type=wave&warnType=0
  /api/data/warnHistoryList?type=wave&warnType=0&year=2026

This adapter covers official marine warnings (wave/storm surge/ice/tsunami).
Forecast map layers are separate products and are not scraped here.
"""
from __future__ import annotations

import html
import re

from .http_client import cached_json

BASE = "https://www.nmefc.cn/api/data"
WARNING_URL = f"{BASE}/warning"
YEAR_URL = f"{BASE}/warnYear"
HISTORY_URL = f"{BASE}/warnHistoryList"

TYPE_CN = {
    "wave": "海浪",
    "storm": "风暴潮",
    "ice": "海冰",
    "bore": "海啸",
}


def _strip_html(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def get_current_warnings(ttl: int = 600) -> dict:
    cached = cached_json(WARNING_URL, ttl=ttl, encoding="utf-8")
    payload = cached["json"]
    items = payload.get("obj") or []
    return {
        "adapter": "nmefc_warnings",
        "items": items,
        "source_url": WARNING_URL,
        "page_url": "https://www.nmefc.cn/",
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "国家海洋预报台当前海洋警报（海浪/风暴潮/海冰/海啸）；预报场地图服务未接。",
    }


def get_years(type_: str = "wave", warn_type: str = "0", ttl: int = 86400) -> dict:
    url = f"{YEAR_URL}?type={type_}&warnType={warn_type}"
    cached = cached_json(url, ttl=ttl, encoding="utf-8")
    return {
        "adapter": "nmefc_warning_years",
        "type": type_,
        "warn_type": warn_type,
        "items": (cached["json"].get("obj") or []),
        "source_url": url,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
    }


def get_history(type_: str = "wave", warn_type: str = "0", year: int = 2026, ttl: int = 3600) -> dict:
    url = f"{HISTORY_URL}?type={type_}&warnType={warn_type}&year={int(year)}"
    cached = cached_json(url, ttl=ttl, encoding="utf-8")
    obj = cached["json"].get("obj") or {}
    items = []
    for date_str, day_items in obj.items():
        for item in day_items or []:
            items.append({
                "date": date_str,
                "title": item.get("title"),
                "subtitle": item.get("subtitle"),
                "level": item.get("level"),
                "type": item.get("type"),
                "type_cn": TYPE_CN.get(item.get("type"), item.get("type")),
                "org_unit": item.get("orgUnit"),
                "alarm_date": item.get("alarmDate"),
                "update_date": item.get("updateDate"),
                "code": item.get("code"),
                "description": _strip_html(item.get("description") or ""),
                "image": item.get("image"),
            })
    items.sort(key=lambda x: (x.get("date") or "", x.get("alarm_date") or ""), reverse=True)
    return {
        "adapter": "nmefc_warning_history",
        "type": type_,
        "type_cn": TYPE_CN.get(type_, type_),
        "year": int(year),
        "count": len(items),
        "items": items,
        "source_url": url,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "国家海洋预报台历史海洋警报；目前公开历史年份有限，按接口返回为准。",
    }


def get_warnings(type_: str = "wave", year: int | None = None) -> dict:
    if year:
        return get_history(type_=type_, year=year)
    current = get_current_warnings()
    filtered = [x for x in current["items"] if x.get("type") == type_]
    current["items"] = filtered
    current["type"] = type_
    current["type_cn"] = TYPE_CN.get(type_, type_)
    current["count"] = len(filtered)
    return current
