"""National Climate Center (NCC) ENSO adapter.

The NCC ENSO monitoring report page (cmdp.ncc-cma.net) requires login:
  http://cmdp.ncc-cma.net/Monitoring/cn_report.php?product=cn_report_enso
  -> "请登录后使用本系统"

This adapter therefore:
  1) returns a clear login-required status for the numeric monitoring API;
  2) extracts public NCC news items mentioning ENSO/厄尔尼诺 from the public homepage.
Numeric NCC values used in the prototype come from official press releases and
are kept as static references, not scraped from the login-only monitoring page.
"""
from __future__ import annotations

import html
import re

from .http_client import cached_text

HOME = "https://www.ncc-cma.net/"
MONITOR_URL = "http://cmdp.ncc-cma.net/Monitoring/cn_report.php?product=cn_report_enso"


def _strip_tags(text: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", text or "")).strip()


def get_status() -> dict:
    return {
        "adapter": "ncc_enso",
        "login_required": True,
        "numeric_api_available": False,
        "home_url": HOME,
        "monitor_url": MONITOR_URL,
        "note": (
            "NCC 的 ENSO 监测页需要登录；当前数值用官方发布会/新闻稿引用，"
            "并与 NOAA CPC ONI 对照。不要在未登录情况下抓取监测页。"
        ),
    }


def get_public_news(keyword: str = "厄尔尼诺", limit: int = 5, ttl: int = 3600) -> dict:
    cached = cached_text(HOME, ttl=ttl, encoding="utf-8")
    text = cached["text"]
    items = []
    seen = set()
    for href, inner in re.findall(r'<a[^>]+href="([^"]+)"[^>]*>(.*?)</a>', text, re.S | re.I):
        title = _strip_tags(inner)
        if keyword not in title or href in seen:
            continue
        seen.add(href)
        if href.startswith("/"):
            href = HOME.rstrip("/") + href
        items.append({"title": title, "url": href})
        if len(items) >= limit:
            break
    return {
        "adapter": "ncc_enso_public_news",
        "keyword": keyword,
        "items": items,
        "source_url": HOME,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "国家气候中心公开首页新闻；不是 ENSO 数值接口。",
    }
