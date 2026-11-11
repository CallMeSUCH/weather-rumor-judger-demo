"""China Internet Joint Rumor Refutation Platform (piyao.org.cn) adapter.

Public search endpoint used by piyao.org.cn:
  https://so.news.cn/xhtvapp/rumourSearch?content=台风&pageNum=1&pageSize=10&sort=-2

The search is keyword-based, not event-time filtered. Use it as background /
case reference, not as a factual verdict.
"""
from __future__ import annotations

import html
import re
from urllib.parse import urlencode

from .http_client import cached_json

BASE = "https://so.news.cn/xhtvapp/rumourSearch"
PAGE_URL = "https://www.piyao.org.cn/pysjk/frontsql.htm"


def _strip_html(text: str) -> str:
    if not text:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", "", text)
    return html.unescape(text).strip()


def search(keyword: str, page: int = 1, page_size: int = 10, ttl: int = 3600) -> dict:
    params = {
        "title": keyword,
        "pageNum": page,
        "pageSize": page_size,
        "sort": "-2",
    }
    url = f"{BASE}?{urlencode(params)}"
    cached = cached_json(
        url,
        ttl=ttl,
        encoding="utf-8",
        headers={
            "Referer": PAGE_URL,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate",
            "X-Requested-With": "XMLHttpRequest",
        },
    )
    payload = cached["json"]
    rows = ((payload.get("content") or {}).get("resultList") or [])
    items = []
    for row in rows:
        content = _strip_html(row.get("content") or "")
        items.append({
            "id": row.get("id"),
            "title": row.get("title"),
            "publish_time": row.get("publishTime"),
            "url": row.get("url"),
            "summary": (row.get("summary") or content[:220]).strip(),
        })
    return {
        "adapter": "piyao_search",
        "keyword": keyword,
        "page": page,
        "count": len(items),
        "items": items,
        "source_url": url,
        "page_url": PAGE_URL,
        "fetched_at": cached["fetched_at_iso"],
        "sha256": cached["sha256"],
        "cache": cached.get("cache"),
        "note": "中国互联网联合辟谣平台标题检索；不是事件时间过滤，只作背景/案例参考，不作为事实判据。",
    }
